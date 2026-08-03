'use strict';

const configuredChannelId = String(process.env.CUSTOM_REQUEST_CHANNEL_ID || '').trim();
const CUSTOM_REQUEST_CHANNEL_ID = /^\d+$/.test(configuredChannelId)
  ? configuredChannelId
  : null;

function requestChannelLabel(message) {
  if (!CUSTOM_REQUEST_CHANNEL_ID) return 'the custom requests channel';

  const guildChannel = message?.guild?.channels?.cache?.get(CUSTOM_REQUEST_CHANNEL_ID);
  const clientChannel = message?.client?.channels?.cache?.get(CUSTOM_REQUEST_CHANNEL_ID);
  const channel = message?.guild ? guildChannel : clientChannel;
  return channel?.id === CUSTOM_REQUEST_CHANNEL_ID
    ? '<#' + CUSTOM_REQUEST_CHANNEL_ID + '>'
    : 'the custom requests channel';
}

module.exports = {
  CUSTOM_REQUEST_CHANNEL_ID,
  requestChannelLabel,
};
