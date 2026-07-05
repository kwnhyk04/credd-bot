'use strict';

const DISABLED_MESSAGE = 'Casino commands are currently disabled.';

async function execute(ctx) {
  return ctx.reply({ content: DISABLED_MESSAGE });
}

module.exports = { execute, DISABLED_MESSAGE };
