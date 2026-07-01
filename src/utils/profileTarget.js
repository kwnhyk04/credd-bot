'use strict';

function resolveProfileTarget(message) {
  const targetUser = message.getMention(0) || message.author;
  const targetMember = message.guild?.members?.cache?.get(targetUser.id) || null;
  const displayName = targetMember?.displayName
    || targetUser.globalName
    || targetUser.username;

  return {
    targetUser,
    targetMember,
    isOther: targetUser.id !== message.author.id,
    discordId: targetUser.id,
    displayName,
    avatarUrl: targetUser.displayAvatarURL({ extension: 'png', size: 512 }),
    fallbackAvatarUrl: targetUser.defaultAvatarURL,
  };
}

module.exports = { resolveProfileTarget };
