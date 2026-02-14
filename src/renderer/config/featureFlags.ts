export const featureFlags = {
  peer_manager_v2: true,
  async_logger: true,
  diagnostics_panel: true,
  moderation_controls: false,
  push_to_talk: true
} as const

export type FeatureFlagName = keyof typeof featureFlags

export function isFeatureEnabled(flag: FeatureFlagName): boolean {
  return Boolean(featureFlags[flag])
}
