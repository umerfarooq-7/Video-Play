'use client'

import { useActionState } from 'react'
import { applyForUploader, type ActionState } from '@/lib/studio/actions'
import {
  CheckboxField,
  Field,
  FormMessage,
  SubmitButton,
  TextareaField,
} from '@/components/form'

export function ApplyForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(
    applyForUploader,
    null,
  )

  if (state?.success) {
    return <FormMessage success={state.success} />
  }

  return (
    <form
      action={formAction}
      className="space-y-4 rounded-xl border border-border bg-surface p-4"
    >
      <FormMessage error={state?.error} />

      <TextareaField
        label="Tell us about yourself and what you plan to upload"
        name="statement"
        required
        rows={6}
        maxLength={2000}
        hint="Who you are, whether you produce your own material, and roughly what you intend to publish."
        errors={state?.fieldErrors?.statement}
      />

      <Field
        label="Website or existing profile"
        name="siteUrl"
        type="url"
        placeholder="https://"
        hint="Optional, but it makes approval considerably faster."
        errors={state?.fieldErrors?.siteUrl}
      />

      <CheckboxField
        name="rightsAttested"
        errors={state?.fieldErrors?.rightsAttested}
      >
        I confirm that I hold the distribution rights to everything I upload,
        that every performer was at least 18 years old at the time of
        production, and that every performer consented to distribution. I
        understand that uploading material I do not have rights to, or that
        depicts anyone underage or non-consenting, will result in permanent
        removal and may be reported to law enforcement.
      </CheckboxField>

      <SubmitButton pendingLabel="Submitting…">Submit application</SubmitButton>
    </form>
  )
}
