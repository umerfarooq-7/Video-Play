'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin, requireStaff } from '@/lib/auth/guards'

export type ActionState = { error?: string; success?: string } | null

/**
 * Append to the audit trail.
 *
 * Uses the service-role client because audit_log has no insert policy by
 * design: the table is append-only from the server, so nothing reachable from
 * a browser can forge or edit an entry.
 *
 * A failed audit write must never silently swallow the action that preceded
 * it, but it also must not roll back a completed moderation decision — so it
 * logs loudly and carries on.
 */
async function audit(entry: {
  actorId: string
  action: string
  entityType: string
  entityId: string
  detail?: Record<string, unknown>
}) {
  try {
    const admin = createAdminClient()
    await admin.from('audit_log').insert({
      actor_id: entry.actorId,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      detail: entry.detail ?? {},
    })
  } catch (error) {
    console.error('[audit] failed to record action', entry.action, error)
  }
}

// ---------------------------------------------------------------------------
// Uploader applications
// ---------------------------------------------------------------------------

const decisionSchema = z.object({
  applicationId: z.uuid(),
  note: z.string().trim().max(1000).optional(),
})

export async function approveUploader(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin()

  const parsed = decisionSchema.safeParse({
    applicationId: formData.get('applicationId'),
    note: formData.get('note') || undefined,
  })

  if (!parsed.success) return { error: 'Invalid request.' }

  const supabase = await createClient()

  const { data: application } = await supabase
    .from('uploader_applications')
    .select('id, user_id, status')
    .eq('id', parsed.data.applicationId)
    .single()

  if (!application) return { error: 'Application not found.' }
  if (application.status !== 'pending') {
    return { error: 'That application has already been decided.' }
  }

  const { error: appError } = await supabase
    .from('uploader_applications')
    .update({
      status: 'approved',
      reviewed_by: admin.id,
      reviewed_at: new Date().toISOString(),
      review_note: parsed.data.note ?? null,
    })
    .eq('id', application.id)

  if (appError) return { error: appError.message }

  // Grants the actual privilege. Permitted here because requireAdmin() passed
  // and the profiles trigger allows admins to set uploader_status.
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ uploader_status: 'approved', role: 'uploader' })
    .eq('id', application.user_id)

  if (profileError) return { error: profileError.message }

  await audit({
    actorId: admin.id,
    action: 'uploader.approve',
    entityType: 'profile',
    entityId: application.user_id,
    detail: { applicationId: application.id },
  })

  revalidatePath('/admin/uploaders')
  return { success: 'Uploader approved.' }
}

export async function rejectUploader(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin()

  const parsed = decisionSchema.safeParse({
    applicationId: formData.get('applicationId'),
    note: formData.get('note') || undefined,
  })

  if (!parsed.success) return { error: 'Invalid request.' }

  if (!parsed.data.note) {
    // The applicant sees this note. Rejecting with no reason produces repeat
    // applications, so require one.
    return { error: 'Give a reason — the applicant sees it.' }
  }

  const supabase = await createClient()

  const { data: application } = await supabase
    .from('uploader_applications')
    .select('id, user_id, status')
    .eq('id', parsed.data.applicationId)
    .single()

  if (!application) return { error: 'Application not found.' }
  if (application.status !== 'pending') {
    return { error: 'That application has already been decided.' }
  }

  await supabase
    .from('uploader_applications')
    .update({
      status: 'rejected',
      reviewed_by: admin.id,
      reviewed_at: new Date().toISOString(),
      review_note: parsed.data.note,
    })
    .eq('id', application.id)

  await supabase
    .from('profiles')
    .update({ uploader_status: 'rejected' })
    .eq('id', application.user_id)

  await audit({
    actorId: admin.id,
    action: 'uploader.reject',
    entityType: 'profile',
    entityId: application.user_id,
    detail: { applicationId: application.id, note: parsed.data.note },
  })

  revalidatePath('/admin/uploaders')
  return { success: 'Application rejected.' }
}

// ---------------------------------------------------------------------------
// Video moderation
// ---------------------------------------------------------------------------

const videoDecisionSchema = z.object({
  videoId: z.uuid(),
  note: z.string().trim().max(1000).optional(),
})

export async function publishVideo(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requireStaff()

  const parsed = videoDecisionSchema.safeParse({
    videoId: formData.get('videoId'),
    note: formData.get('note') || undefined,
  })

  if (!parsed.success) return { error: 'Invalid request.' }

  const supabase = await createClient()

  const { data: video } = await supabase
    .from('videos')
    .select('id, status, playback_hls_path')
    .eq('id', parsed.data.videoId)
    .single()

  if (!video) return { error: 'Video not found.' }

  if (!video.playback_hls_path) {
    return {
      error:
        'That video has no playable media yet. Wait for processing to finish.',
    }
  }

  // published_at is stamped by the stamp_published_at trigger.
  const { error } = await supabase
    .from('videos')
    .update({
      status: 'published',
      moderated_by: staff.id,
      moderated_at: new Date().toISOString(),
      moderation_note: parsed.data.note ?? null,
    })
    .eq('id', video.id)

  if (error) return { error: error.message }

  await audit({
    actorId: staff.id,
    action: 'video.publish',
    entityType: 'video',
    entityId: video.id,
  })

  revalidatePath('/admin/moderation')
  revalidatePath('/')
  return { success: 'Video published.' }
}

export async function rejectVideo(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requireStaff()

  const parsed = videoDecisionSchema.safeParse({
    videoId: formData.get('videoId'),
    note: formData.get('note') || undefined,
  })

  if (!parsed.success) return { error: 'Invalid request.' }
  if (!parsed.data.note) {
    return { error: 'Give a reason — the uploader sees it.' }
  }

  const supabase = await createClient()

  const { error } = await supabase
    .from('videos')
    .update({
      status: 'rejected',
      moderated_by: staff.id,
      moderated_at: new Date().toISOString(),
      moderation_note: parsed.data.note,
    })
    .eq('id', parsed.data.videoId)

  if (error) return { error: error.message }

  await audit({
    actorId: staff.id,
    action: 'video.reject',
    entityType: 'video',
    entityId: parsed.data.videoId,
    detail: { note: parsed.data.note },
  })

  revalidatePath('/admin/moderation')
  return { success: 'Video rejected.' }
}

/** Take down an already-published video (DMCA, ToS, report outcome). */
export async function removeVideo(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requireStaff()

  const parsed = videoDecisionSchema.safeParse({
    videoId: formData.get('videoId'),
    note: formData.get('note') || undefined,
  })

  if (!parsed.success) return { error: 'Invalid request.' }
  if (!parsed.data.note) {
    return { error: 'Record why this was removed — it is the takedown trail.' }
  }

  const supabase = await createClient()

  const { error } = await supabase
    .from('videos')
    .update({
      status: 'removed',
      moderated_by: staff.id,
      moderated_at: new Date().toISOString(),
      moderation_note: parsed.data.note,
    })
    .eq('id', parsed.data.videoId)

  if (error) return { error: error.message }

  await audit({
    actorId: staff.id,
    action: 'video.remove',
    entityType: 'video',
    entityId: parsed.data.videoId,
    detail: { note: parsed.data.note },
  })

  revalidatePath('/admin/moderation')
  revalidatePath('/')
  return { success: 'Video removed.' }
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

const reportSchema = z.object({
  reportId: z.uuid(),
  resolution: z.string().trim().max(1000).optional(),
  outcome: z.enum(['actioned', 'dismissed', 'triaged']),
})

export async function resolveReport(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requireStaff()

  const parsed = reportSchema.safeParse({
    reportId: formData.get('reportId'),
    resolution: formData.get('resolution') || undefined,
    outcome: formData.get('outcome'),
  })

  if (!parsed.success) return { error: 'Invalid request.' }

  const supabase = await createClient()

  const { error } = await supabase
    .from('reports')
    .update({
      status: parsed.data.outcome,
      handled_by: staff.id,
      handled_at: new Date().toISOString(),
      resolution: parsed.data.resolution ?? null,
    })
    .eq('id', parsed.data.reportId)

  if (error) return { error: error.message }

  await audit({
    actorId: staff.id,
    action: `report.${parsed.data.outcome}`,
    entityType: 'report',
    entityId: parsed.data.reportId,
  })

  revalidatePath('/admin/reports')
  return { success: 'Report updated.' }
}
