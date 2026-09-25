/**
 * THE CLOSED LIST OF SUITES THAT NEED A REAL POSTGRESQL CLUSTER.
 *
 * One list, read three ways, because a proof owned by nobody is a proof that
 * runs nowhere: `npm run test:rls` runs exactly these, the `unit-tests` and
 * `coverage` jobs exclude exactly these (they install no cluster), and
 * `__tests__/postgresSuiteInventory.test.ts` fails when a suite starts a
 * cluster without joining the list. That fence is the fix for the day three
 * migration proofs landed in a job with no PostgreSQL and reported themselves
 * skipped while the job stayed green.
 *
 * Membership is not a judgement: a suite belongs here exactly when it imports
 * `__tests__/helpers/postgres` or `scripts/rls/session-harness.mjs`.
 */
export const POSTGRES_BACKED_SUITES = Object.freeze([
  "__tests__/accountRemovalMigrationEffective.test.ts",
  "__tests__/accountRetentionLedgerMigrationEffective.test.ts",
  "__tests__/accountVisibilityMigrationEffective.test.ts",
  "__tests__/foundingMembersMigration.test.ts",
  "__tests__/groupMessageThreadsMigrationEffective.test.ts",
  "__tests__/handleClaimNoInheritanceMigration.test.ts",
  "__tests__/harvestOverlayMigration.test.ts",
  "__tests__/messageIdempotencyMigrationEffective.test.ts",
  "__tests__/messagingChannelOwnershipMigrationEffective.test.ts",
  "__tests__/messagingRealtimeAuthorizationMigrationEffective.test.ts",
  "__tests__/nightSignalCheckpointMigrationEffective.test.ts",
  "__tests__/occupancyMigration0109.test.ts",
  "__tests__/occupancyMigrationEffective.test.ts",
  "__tests__/oneTapPricePairRemovalEffective.test.ts",
  "__tests__/openSocialCrewsMigration.test.ts",
  "__tests__/permissionMatrixEffective.test.ts",
  "__tests__/pintDropConfirmationsMigrationEffective.test.ts",
  "__tests__/pintDropDailyCapAtomicEffective.test.ts",
  "__tests__/pintDropMeasureMigrationEffective.test.ts",
  "__tests__/pintDropVerifiedReportsMigrationEffective.test.ts",
  "__tests__/planAccountTransitionMigrationEffective.test.ts",
  "__tests__/planJoinRevokedPrecheckEffective.test.ts",
  "__tests__/planLegacyReplayCapabilityEffective.test.ts",
  "__tests__/postgresShmHarness.test.ts",
  "__tests__/priceTrustEventsMigrationEffective.test.ts",
  "__tests__/rateLimitExpiryMigration.test.ts",
  "__tests__/rlsWave2Session.test.ts",
  "__tests__/socialComposerMigration.test.ts",
  "__tests__/socialCrewLegacyRoutesRls.test.ts",
  "__tests__/socialCrewMigration.test.ts",
  "__tests__/socialIdentityMigration.test.ts",
  "__tests__/socialInteractionsMigration.test.ts",
  "__tests__/socialPostsMigration.test.ts",
  "__tests__/wantedPromotionMigrationEffective.test.ts",
  "__tests__/whatsOnListingsMigration.test.ts",
]);

/**
 * The SysV harness proof boots init-parented clusters outside the host slot
 * budget and asserts on the segments its own postmasters created, so it runs
 * alone: a concurrent worker's first-slot sweep would reap its orphans first.
 */
export const SERIAL_SHM_RUN = Object.freeze({
  suites: Object.freeze(["__tests__/postgresShmHarness.test.ts"]),
  env: Object.freeze({ PUBMAX_SERIAL_SHM_HARNESS: "1" }),
});

/** The vitest runs `npm run test:rls` makes, in order: together they are every suite above. */
export const POSTGRES_SUITE_RUNS = Object.freeze([
  Object.freeze({
    suites: Object.freeze(
      POSTGRES_BACKED_SUITES.filter((suite) => !SERIAL_SHM_RUN.suites.includes(suite)),
    ),
    env: Object.freeze({}),
  }),
  SERIAL_SHM_RUN,
]);
