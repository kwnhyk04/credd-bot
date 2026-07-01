'use strict';

const { SeparatorSpacingSize } = require('discord.js');

function smallDivider(separator) {
  return separator.setSpacing(SeparatorSpacingSize.Small).setDivider(true);
}

module.exports = {
  smallDivider,
};
