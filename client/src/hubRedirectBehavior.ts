/**
 * Hub redirect request behavior using the non-deprecated RedirectRpcClient.call() API.
 * Ported from VeriLock `client/src/hubRedirectBehavior.ts` (P1-01).
 *
 * Stock `@nimiq/hub-api` RedirectRequestBehavior still calls callAndSaveLocalState(),
 * which logs a console deprecation warning on every Hub redirect. Behavior is identical:
 * store local state + command, handle history.back, then full-page navigate to Hub.
 *
 * @see https://www.nimiq.dev/hub/guide/concepts#preserving-state-across-redirects
 */

import { RedirectRpcClient, ResponseMethod } from '@nimiq/rpc'

export type HubRedirectLocalState = Record<string, unknown>

/**
 * Drop-in replacement for `new HubApi.RedirectRequestBehavior(returnUrl, localState)`.
 * Pass the result as the second argument to hub.chooseAddress / signMessage / checkout.
 */
export function createHubRedirectBehavior(
  returnUrl: string,
  localState: HubRedirectLocalState = {},
): {
  request: (
    endpoint: string,
    command: string,
    args: Iterable<PromiseLike<unknown> | unknown>,
  ) => Promise<void>
} {
  if (Object.prototype.hasOwnProperty.call(localState, '__command')) {
    throw new Error("Invalid localState: Property '__command' is reserved")
  }

  return {
    async request(endpoint, command, args) {
      const origin = new URL(endpoint).origin
      const client = new RedirectRpcClient(endpoint, origin)
      // Clears leftover return fragments / history.back rejection; same as stock Hub API.
      await client.init()
      const state = { ...localState, __command: command }
      const resolvedArgs = await Promise.all([...args])
      client.call(
        returnUrl,
        command,
        {
          responseMethod: ResponseMethod.HTTP_GET,
          state,
          handleHistoryBack: true,
        },
        ...resolvedArgs,
      )
    },
  }
}
