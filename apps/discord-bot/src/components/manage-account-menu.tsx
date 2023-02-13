import React from "react";
import type { UserServerSettingsWithFlags } from "@answeroverflow/db";
import { ToggleButton } from "./toggle-button";
import { updateUserConsent } from "~discord-bot/domains/consent";
import { callAPI, componentEventStatusHandler } from "~discord-bot/utils/trpc";
import { guildOnlyComponentEvent } from "~discord-bot/utils/conditions";
import { updateUserServerIndexingEnabled } from "~discord-bot/domains/manage-account";
import { Button, Embed } from "@answeroverflow/reacord";
import { Spacer } from "./spacer";
import { ANSWER_OVERFLOW_BLUE_AS_INT } from "~discord-bot/utils/constants";
import { createMemberCtx } from "~discord-bot/utils/context";

type ManageAccountMenuItemProps = {
  settings: UserServerSettingsWithFlags;
  setSettings: (settings: UserServerSettingsWithFlags) => void;
};
export const REVOKE_CONSENT_LABEL = "Disable publicly showing messages";
export const GRANT_CONSENT_LABEL = "Publicly display messages on Answer Overflow";

const ToggleConsentButton = ({ settings, setSettings }: ManageAccountMenuItemProps) => (
  <ToggleButton
    currentlyEnabled={settings.flags.canPubliclyDisplayMessages}
    enableLabel={GRANT_CONSENT_LABEL}
    disabled={settings.flags.messageIndexingDisabled}
    disableLabel={REVOKE_CONSENT_LABEL}
    onClick={(event, enabled) => {
      void guildOnlyComponentEvent(event, async ({ member }) => {
        await updateUserConsent({
          canPubliclyDisplayMessages: enabled,
          consentSource: "manage-account-menu",
          member,
          onSettingChange(updatedSettings) {
            setSettings(updatedSettings);
          },
          onError: (error) => componentEventStatusHandler(event, error.message),
        });
      });
    }}
  />
);

export const DISABLE_INDEXING_LABEL = "Ignore account in server";
export const ENABLE_INDEXING_LABEL = "Enable indexing of messages";
const ToggleIndexingButton = ({ settings, setSettings }: ManageAccountMenuItemProps) => (
  <ToggleButton
    currentlyEnabled={!settings.flags.messageIndexingDisabled}
    enableLabel={ENABLE_INDEXING_LABEL}
    disableLabel={DISABLE_INDEXING_LABEL}
    onClick={(event, messageIndexingDisabled) => {
      void guildOnlyComponentEvent(event, async ({ member }) => {
        await updateUserServerIndexingEnabled({
          member,
          messageIndexingDisabled: !messageIndexingDisabled,
          onError: (error) => componentEventStatusHandler(event, error.message),
          onSettingChange(newSettings) {
            setSettings(newSettings);
          },
        });
      });
    }}
  />
);

export const GLOBALLY_IGNORE_ACCOUNT_LABEL = "Globally ignore account";
export const GloballyIgnoreAccountButton = ({
  setIsGloballyIgnored,
}: {
  setIsGloballyIgnored: (isGloballyIgnored: boolean) => void;
}) => (
  <Button
    label={GLOBALLY_IGNORE_ACCOUNT_LABEL}
    style="danger"
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    onClick={async (event) => {
      await guildOnlyComponentEvent(event, async ({ member }) =>
        callAPI({
          apiCall: (router) => router.discordAccounts.delete(event.user.id),
          getCtx: () => createMemberCtx(member),
          Error: (error) => componentEventStatusHandler(event, error.message),
          Ok: () => setIsGloballyIgnored(true),
        })
      );
    }}
  />
);

export const STOP_IGNORING_ACCOUNT_LABEL = "Stop ignoring account";
export const StopIgnoringAccountButton = ({
  setIsGloballyIgnored,
}: {
  setIsGloballyIgnored: (isGloballyIgnored: boolean) => void;
}) => (
  <Button
    label={STOP_IGNORING_ACCOUNT_LABEL}
    style="success"
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    onClick={async (event) => {
      await guildOnlyComponentEvent(event, async ({ member }) =>
        callAPI({
          apiCall: (router) => router.ignoredDiscordAccounts.stopIgnoring(event.user.id),
          getCtx: () => createMemberCtx(member),
          Error: (error) => componentEventStatusHandler(event, error.message),
          Ok: () => setIsGloballyIgnored(false),
        })
      );
    }}
  />
);

type MenuInstruction = {
  title: string;
  instructions: string;
  enabled: boolean;
};

// TODO: Make this take in the caller as a prop and compare that when the button is clicked?
// Doesn't matter that much since the action only affects the button clicker
export function ManageAccountMenu({
  initalSettings,
  initalIsGloballyIgnored,
}: {
  initalSettings: UserServerSettingsWithFlags;
  initalIsGloballyIgnored: boolean;
}) {
  const [settings, setSettings] = React.useState(initalSettings);
  const [isGloballyIgnored, setIsGloballyIgnored] = React.useState(initalIsGloballyIgnored);
  const instructions: MenuInstruction[] = [
    {
      instructions:
        "Allows anyone to see your messages sent in indexed help channels on Answer Overflow. This allows people to find answers to similar questions that you have asked or answered",
      title: "Publicly display messages on Answer Overflow",
      enabled: !settings.flags.canPubliclyDisplayMessages,
    },
    {
      instructions:
        "Your messages will only be visible on Answer Overflow to those that share a server with you",
      title: REVOKE_CONSENT_LABEL,
      enabled: settings.flags.canPubliclyDisplayMessages,
    },
    {
      instructions:
        "Enables your messages to be indexed in this server, they will appear on AnswerOverflow behind a sign in if you have not consented to publicly display them",
      title: ENABLE_INDEXING_LABEL,
      enabled: settings.flags.messageIndexingDisabled,
    },
    {
      instructions:
        "Disables indexing of your account in this server, also will remove all the messages that Answer Overflow has stored from you in this server",
      title: DISABLE_INDEXING_LABEL,
      enabled: !settings.flags.messageIndexingDisabled,
    },
  ];

  const RegularView = () => (
    <>
      <Embed color={ANSWER_OVERFLOW_BLUE_AS_INT}>
        {instructions.map(
          ({ title, instructions, enabled }) =>
            enabled && (
              <>
                **{title}** - {instructions}
                <Spacer count={2} key={title} />
              </>
            )
        )}
      </Embed>
      <ToggleConsentButton setSettings={setSettings} settings={settings} />
      <ToggleIndexingButton setSettings={setSettings} settings={settings} />
      <GloballyIgnoreAccountButton setIsGloballyIgnored={setIsGloballyIgnored} />
    </>
  );

  return isGloballyIgnored ? (
    <StopIgnoringAccountButton setIsGloballyIgnored={setIsGloballyIgnored} />
  ) : (
    <RegularView />
  );
}
