import {
  findUserServerSettingsById,
  getDefaultUserServerSettingsWithFlags,
  upsertUserServerSettingsWithDeps,
  UserServerSettingsWithFlags,
  zUserServerSettingsCreateWithDeps,
  zUserServerSettingsFind,
  zUserServerSettingsFlags,
} from "@answeroverflow/db";
import { withDiscordAccountProcedure, MergeRouters, router } from "../trpc";
import { protectedFetch, protectedMutation } from "~api/utils/protected-procedures";
import { assertIsUser } from "~api/utils/permissions";

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  MANAGE_ACCOUNT_SOURCES,
  CONSENT_SOURCES,
  CONSENT_ALREADY_DENIED_MESSAGE,
  CONSENT_EXPLICITLY_SET_MESSAGE,
  CONSENT_ALREADY_GRANTED_MESSAGE,
  MESSAGE_INDEXING_ALREADY_DISABLED_MESSAGE,
  MESSAGE_INDEXING_ALREADY_ENABLED_MESSAGE,
  CONSENT_PREVENTED_BY_DISABLED_INDEXING_MESSAGE,
} from "./types";
export const SERVER_NOT_SETUP_MESSAGE = "Server is not setup for Answer Overflow yet";

function assertValuesAreNotEqual({
  oldValue,
  newValue,
  truthyMessage,
  falsyMessage,
}: {
  oldValue: boolean;
  newValue: boolean;
  truthyMessage: string;
  falsyMessage: string;
}) {
  if (oldValue === newValue) {
    return new TRPCError({
      code: "PRECONDITION_FAILED",
      message: oldValue ? truthyMessage : falsyMessage,
    });
  }
  return;
}

function assertIsNotValue({
  actualValue,
  expectedToNotBeValue,
  errorMessage,
}: {
  actualValue: boolean;
  expectedToNotBeValue: boolean;
  errorMessage: string;
}) {
  if (actualValue === expectedToNotBeValue) {
    return new TRPCError({
      code: "PRECONDITION_FAILED",
      message: errorMessage,
    });
  }
  return;
}

async function findOrGiveDefaultUserServerSettings({
  operation,
  find,
}: {
  operation: (input: {
    oldSettings: UserServerSettingsWithFlags;
    doSettingsExistAlready: boolean;
  }) => Promise<UserServerSettingsWithFlags>;
  find: {
    userId: string;
    serverId: string;
  };
}) {
  let oldSettings = await findUserServerSettingsById(find);
  let doSettingsExistAlready = true;
  if (!oldSettings) {
    oldSettings = getDefaultUserServerSettingsWithFlags(find);
    doSettingsExistAlready = false;
  } else {
    doSettingsExistAlready = true;
  }
  return operation({ oldSettings, doSettingsExistAlready });
}

const userServerSettingsCrudRouter = router({
  byId: withDiscordAccountProcedure.input(zUserServerSettingsFind).query(async ({ input, ctx }) => {
    return protectedFetch({
      permissions: () => assertIsUser(ctx, input.userId),
      fetch: () => findUserServerSettingsById(input),
      notFoundMessage: "User server settings not found",
    });
  }),
  setIndexingDisabled: withDiscordAccountProcedure
    .input(
      z.object({
        source: z.enum(MANAGE_ACCOUNT_SOURCES),
        data: zUserServerSettingsCreateWithDeps
          .pick({
            serverId: true,
            user: true,
          })
          .extend({
            flags: zUserServerSettingsFlags.pick({
              messageIndexingDisabled: true,
            }),
          }),
      })
    )
    .mutation(({ input, ctx }) => {
      return findOrGiveDefaultUserServerSettings({
        find: { userId: input.data.user.id, serverId: input.data.serverId },
        operation: ({ oldSettings: existingSettings }) =>
          protectedMutation({
            permissions: [
              () => assertIsUser(ctx, input.data.user.id),
              () =>
                assertValuesAreNotEqual({
                  falsyMessage: MESSAGE_INDEXING_ALREADY_DISABLED_MESSAGE,
                  truthyMessage: MESSAGE_INDEXING_ALREADY_ENABLED_MESSAGE,
                  newValue: input.data.flags.messageIndexingDisabled,
                  oldValue: existingSettings.flags.messageIndexingDisabled,
                }),
            ],
            operation: () =>
              upsertUserServerSettingsWithDeps({
                ...input.data,
                flags: {
                  ...input.data.flags,
                  canPubliclyDisplayMessages: input.data.flags.messageIndexingDisabled
                    ? false
                    : existingSettings.flags.canPubliclyDisplayMessages,
                },
              }),
          }),
      });
    }),
  setConsentGranted: withDiscordAccountProcedure
    .input(
      z.object({
        source: z.enum(CONSENT_SOURCES),
        data: zUserServerSettingsCreateWithDeps
          .pick({
            serverId: true,
            user: true,
          })
          .extend({
            flags: zUserServerSettingsFlags.pick({
              canPubliclyDisplayMessages: true,
            }),
          }),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const isAutomatedConsent =
        input.source === "forum-post-guidelines" || input.source === "read-the-rules";
      return findOrGiveDefaultUserServerSettings({
        find: { userId: input.data.user.id, serverId: input.data.serverId },
        operation: ({ oldSettings, doSettingsExistAlready }) =>
          protectedMutation({
            permissions: [
              () => assertIsUser(ctx, input.data.user.id),
              () =>
                input.data.flags.canPubliclyDisplayMessages
                  ? assertIsNotValue({
                      actualValue: oldSettings.flags.messageIndexingDisabled,
                      expectedToNotBeValue: true,
                      errorMessage: CONSENT_PREVENTED_BY_DISABLED_INDEXING_MESSAGE,
                    })
                  : undefined,
              () =>
                isAutomatedConsent
                  ? assertIsNotValue({
                      actualValue: doSettingsExistAlready,
                      expectedToNotBeValue: true,
                      errorMessage: CONSENT_EXPLICITLY_SET_MESSAGE,
                    })
                  : assertValuesAreNotEqual({
                      falsyMessage: CONSENT_ALREADY_DENIED_MESSAGE,
                      truthyMessage: CONSENT_ALREADY_GRANTED_MESSAGE,
                      newValue: input.data.flags.canPubliclyDisplayMessages,
                      oldValue: oldSettings.flags.canPubliclyDisplayMessages,
                    }),
            ],
            operation: () => upsertUserServerSettingsWithDeps(input.data),
          }),
      });
    }),
});

export const userServerSettingsRouter = MergeRouters(userServerSettingsCrudRouter);
