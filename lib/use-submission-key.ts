'use client'

import { useState } from 'react'

/**
 * A key that changes every time a form's action returns — put it on the <form>.
 *
 *   const [state, formAction] = useActionState(action, {})
 *   const formKey = useSubmissionKey(state)
 *   <form key={formKey} action={formAction}>…
 *
 * Why: after a <form action> resolves, React calls `form.reset()`, which puts
 * every field back to its *default*. For plain text inputs that is fine as long
 * as `defaultValue` is fed from the echoed `state.values`. It is not fine for:
 *
 *   - controlled <select value> — React never sets `defaultSelected`, so the
 *     reset jumps the DOM to the first option while React state still holds the
 *     real choice, and the NEXT submit sends the wrong value;
 *   - uncontrolled <select defaultValue> — the previously default option keeps
 *     `defaultSelected`, so the reset can pick the stale one;
 *   - checkboxes whose default came from an earlier render.
 *
 * Remounting the form on each result sidesteps all of it: the old form (and its
 * pending reset) is discarded, and the new one mounts straight from
 * `defaultValue` / `defaultChecked` / controlled state. Fields that are not
 * echoed (passwords) come back empty, which is intentional.
 *
 * Works with any state object, as long as the action returns a fresh object
 * each time — which useActionState always gives you.
 */
export function useSubmissionKey(state: object): number {
  const [seen, setSeen] = useState(state)
  const [key, setKey] = useState(0)

  // Adjusting state during render (not in an effect) so the new key lands in
  // the same commit as the action's result — before React's form reset runs.
  if (seen !== state) {
    setSeen(state)
    setKey((k) => k + 1)
  }

  return key
}
