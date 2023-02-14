import {
  findUserServerSettingsById,
  updateUserServerSettings,
  upsertUserServerSettingsWithDeps,
  UserServerSettingsWithFlags,
  zUserServerSettingsCreateWithDeps,
  zUserServerSettingsFlags,
} from "@answeroverflow/db";
import type { z } from "zod";
import {
  updateSetting,
  UpdateSettingsError,
  UpdateSettingsOptions,
  UPDATE_SETTING_ERROR_REASONS,
} from "./utils";

export const MANAGE_ACCOUNT_SOURCES = ["manage-account-menu"] as const;
export type ManageAccountSource = (typeof MANAGE_ACCOUNT_SOURCES)[number];

export const UPDATE_USER_SERVER_SETTINGS_ERROR_REASONS = [...UPDATE_SETTING_ERROR_REASONS] as const;

export type UpdateUserServerSettingsOptions = Pick<
  UpdateSettingsOptions<
    z.infer<typeof zUserServerSettingsCreateWithDeps>,
    UserServerSettingsWithFlags
  >,
  "checkIfSettingIsAlreadySet" | "onSettingChange" | "onError"
> & {
  source: string;
  updateData: z.infer<typeof zUserServerSettingsCreateWithDeps>;
};

export async function updateUserServerSettingsWithChecks({
  updateData,
  ...rest
}: UpdateUserServerSettingsOptions) {
  return updateSetting({
    newValue: updateData,
    fetchSettings: () =>
      findUserServerSettingsById({
        serverId: updateData.serverId,
        userId: updateData.user.id,
      }),
    updateSettings: (update, existing) => {
      if (!existing) {
        return upsertUserServerSettingsWithDeps(update);
      } else {
        return updateUserServerSettings(
          {
            ...update,
            userId: existing.userId,
          },
          existing
        );
      }
    },
    ...rest,
  });
}

export type UpdateUserServerSettingsOverrideOptions = Pick<
  UpdateUserServerSettingsOptions,
  "onError" | "onSettingChange"
>;

export const zUpdateUserIndexingInServerDisabledData = zUserServerSettingsCreateWithDeps
  .pick({
    serverId: true,
    user: true,
  })
  .extend({
    flags: zUserServerSettingsFlags.pick({
      messageIndexingDisabled: true,
    }),
  });

export async function updateUserIndexingInServerDisabled({
  updateData,
  onError,
  onSettingChange,
}: UpdateUserServerSettingsOverrideOptions & {
  updateData: z.infer<typeof zUpdateUserIndexingInServerDisabledData>;
}) {
  let updateConsentResult: UserServerSettingsWithFlags | null = null;
  const result = await updateUserServerSettingsWithChecks({
    source: "manage-account-menu",
    updateData: updateData,
    checkIfSettingIsAlreadySet({ existingSettings }) {
      if (
        existingSettings.flags.messageIndexingDisabled === updateData.flags.messageIndexingDisabled
      ) {
        throw new UpdateSettingsError(
          `Message indexing is already ${
            updateData.flags.messageIndexingDisabled ? "disabled" : "enabled"
          }"`,
          "target-value-already-equals-goal-value"
        );
      }
    },
    onError: onError,
    async onSettingChange(newSettings) {
      if (newSettings.flags.canPubliclyDisplayMessages) {
        updateConsentResult = await updateUserConsent({
          consentSource: "disable-indexing-button",
          onError: (err) => {
            if (err.reason === "target-value-already-equals-goal-value") {
              return;
            } else {
              onError?.(err);
            }
          },
          onSettingChange,
          updateData: {
            serverId: updateData.serverId,
            user: updateData.user,
            flags: {
              canPubliclyDisplayMessages: false,
            },
          },
        });
      } else {
        await onSettingChange?.(newSettings);
      }
    },
  });
  // If we updated the consent, return that instead as it is the most up to date
  return updateConsentResult ?? result;
}

export const CONSENT_SOURCES = [
  "forum-post-guidelines",
  "read-the-rules",
  "manage-account-menu",
  "slash-command",
  "mark-solution-response",
  "disable-indexing-button",
] as const;

export type ConsentSource = (typeof CONSENT_SOURCES)[number];

export const zUpdateUserConsetInput = zUserServerSettingsCreateWithDeps
  .pick({
    serverId: true,
    user: true,
  })
  .extend({
    flags: zUserServerSettingsFlags.pick({
      canPubliclyDisplayMessages: true,
    }),
  });

export async function updateUserConsent({
  consentSource,
  updateData,
  ...rest
}: {
  consentSource: ConsentSource;
} & UpdateUserServerSettingsOverrideOptions & {
    updateData: z.infer<typeof zUpdateUserConsetInput>;
  }) {
  const isAutomatedConsent =
    consentSource === "forum-post-guidelines" || consentSource === "read-the-rules";
  return await updateUserServerSettingsWithChecks({
    source: consentSource,
    updateData,
    checkIfSettingIsAlreadySet({ existingSettings }) {
      if (isAutomatedConsent) {
        throw new UpdateSettingsError(
          "Cannot set automatically as user has already explicitly set this setting",
          "setting-already-explicitly-set"
        );
      } else if (
        existingSettings.flags.canPubliclyDisplayMessages ===
        updateData.flags.canPubliclyDisplayMessages
      ) {
        // These are only user facing operations so give a more user friendly error message
        throw new UpdateSettingsError(
          `You have already ${
            updateData.flags.canPubliclyDisplayMessages ? "granted" : "revoked"
          } consent to display your messages in this server`,
          "target-value-already-equals-goal-value"
        );
      } else if (
        existingSettings.flags.messageIndexingDisabled &&
        updateData.flags.canPubliclyDisplayMessages
      ) {
        throw new UpdateSettingsError(
          "Cannot grant consent as message indexing is disabled",
          "setting-prevented-by-other-setting"
        );
      }
    },
    ...rest,
  });
}