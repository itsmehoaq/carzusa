function createMessageInteraction(message, subcommand, options = {}) {
  let replyMessage = null;
  let deferred = false;
  let replied = false;

  return {
    client: message.client,
    guild: message.guild,
    channel: message.channel,
    user: message.author,
    member: message.member,
    commandName: "osu",
    get deferred() {
      return deferred;
    },
    get replied() {
      return replied;
    },
    options: {
      getSubcommand: () => subcommand,
      getString: (name) => {
        const val = options[name];
        return val !== undefined && val !== null ? String(val) : null;
      },
      getInteger: (name) => {
        const val = options[name];
        if (val !== undefined && val !== null) {
          const num = parseInt(val, 10);
          if (!isNaN(num)) return num;
        }
        return null;
      },
      getNumber: (name, required = false) => {
        const val = options[name];
        if (val !== undefined && val !== null) {
          const num = Number(val);
          if (!isNaN(num)) return num;
        }
        if (required) throw new Error(`Provide a valid ${name} value for ${subcommand}.`);
        return null;
      },
      getBoolean: (name) => {
        const val = options[name];
        return val !== undefined && val !== null ? Boolean(val) : null;
      },
    },
    async deferReply() {
      deferred = true;
      if (message.channel && typeof message.channel.sendTyping === "function") {
        await message.channel.sendTyping().catch(() => {});
      }
    },
    async editReply(payload) {
      const normalizedPayload = typeof payload === "string" ? { content: payload } : { ...payload };
      if (!replyMessage) {
        replied = true;
        try {
          replyMessage = await message.reply({
            ...normalizedPayload,
            allowedMentions: { repliedUser: false, parse: [] },
          });
        } catch (err) {
          if (err && (err.code === 10008 || err.code === 50035) && message.channel && typeof message.channel.send === "function") {
            replyMessage = await message.channel.send({
              ...normalizedPayload,
              allowedMentions: { parse: [] },
            });
          } else {
            throw err;
          }
        }
        return replyMessage;
      }
      return await replyMessage.edit(normalizedPayload);
    },
    async reply(payload) {
      return this.editReply(payload);
    },
    async followUp(payload) {
      return this.editReply(payload);
    },
  };
}

module.exports = { createMessageInteraction };
