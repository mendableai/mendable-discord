const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const fetch = require("node-fetch");
require("dotenv").config();

// Secrets
const MENDABLE_KEY = process.env["MENDABLE_API_KEY"];
const DISCORD_TOKEN = process.env["DISCORD_TOKEN"];
const BOT_ID = process.env["BOT_ID"]; //

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const historyMap = new Map();
const threadToChannelMap = new Map();

async function createConversation() {
  const url = "https://api.mendable.ai/v1/newConversation";

  const data = {
    api_key: `${MENDABLE_KEY}`,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
  const responseJSON = await response.json();

  return responseJSON["conversation_id"];
}

async function getAnswerAndSources(question, history = []) {
  const url = "https://api.mendable.ai/v1/mendableChat";
  let conversation_id = null;
  if (history.length === 0) {
    conversation_id = await createConversation();
  } else {
    // Get the conversation ID from the history
    conversation_id = history[history.length - 1].conversation_id;
  }

  const data = {
    anon_key: `${MENDABLE_KEY}`,
    question: `${question}`,
    history: history,
    shouldStream: false,
    conversation_id: conversation_id,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  return { response, conversation_id };
}

// When the client is ready, run this code (only once)
client.once("ready", () => {
  console.log("Ready!");
});

client.on("ready", () => {
  console.log("Discord server is ready!");
});

client.on("messageCreate", async (message) => {
  try {
    const messageContent = message.content;
    console.log(messageContent);

    if (!messageContent.startsWith(`<@${BOT_ID}>`)) {
      return;
    }

    let formattedMessage = messageContent;
    formattedMessage = formattedMessage.split(`<@${BOT_ID}>`)[1];

    if (!formattedMessage) return;

    let thread;
    let threadId;
    let channelId = message.channel.id;

    if (message.channel.isThread()) {
      thread = message.channel;
      threadId = thread.id;
      channelId = thread.parentId; // Get the parent channel ID of the thread
    } else {
      thread = await message.startThread({
        name: "Discussion Thread",
        autoArchiveDuration: 60,
      });
      threadId = thread.id;
      channelId = message.channel.id; // Set the parent channel ID to the current channel ID
    }

    threadToChannelMap.set(threadId, channelId); // Add the thread-to-channel mapping

    let history = historyMap.get(threadId) || []; // Use thread ID to look up history instead of channel ID

    const { response, conversation_id } = await getAnswerAndSources(
      formattedMessage.trim(),
      history
    );
    const responseJSON = await response.json();

    const answer = await responseJSON["answer"]["text"];
    const sources = await responseJSON["sources"]
      .map((source) => source["link"])
      .join("\n");

    history.push({
      prompt: formattedMessage.trim(),
      response: answer,
      conversation_id: conversation_id,
    });
    historyMap.set(threadId, history); // Use thread ID to store history instead of channel ID

    if (message.channel.isThread()) {
      await message.reply(`${message.author}\n\n${answer}`);
      if (sources) {
        await message.reply(`Sources:\n${sources}`);
      }
    } else {
      await thread.send(`${message.author}\n\n${answer}\n`);
      if (sources) {
        await thread.send(`\n\n- Verified Sources:\n${sources}`);
      }
    }
  } catch (error) {
    console.log(error);
    console.log("Something went wrong!");
  }
});

client.login(DISCORD_TOKEN);
