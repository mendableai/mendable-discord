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
  const url = "https://api.mendable.ai/v0/newConversation";

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
  const url = "https://api.mendable.ai/v0/mendableChat";
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
    headers: { "Content-Type": "application/json" },
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

    await thread.sendTyping(); // https://discord.com/developers/docs/resources/channel#trigger-typing-indicator
    threadToChannelMap.set(threadId, channelId); // Add the thread-to-channel mapping

    let history = historyMap.get(threadId) || []; // Use thread ID to look up history instead of channel ID

    const { response, conversation_id } = await getAnswerAndSources(
      formattedMessage.trim(),
      history
    );
    const responseJSON = await response.json();

    const answer = await responseJSON["answer"]["text"];
    const sources = await responseJSON["sources"].map(
      (source) => source["link"]
    );

    history.push({
      prompt: formattedMessage.trim(),
      response: answer,
      conversation_id: conversation_id,
    });
    historyMap.set(threadId, history); // Use thread ID to store history instead of channel ID

    const answersList = [];
    let tempString = "";
    let answerIndex = 0;

    const splittedAnswers = answer.split("\n");

    while (answerIndex < splittedAnswers.length) {
      // update 1999 to (n-1) where n is discords per message limit
      while (tempString.length + splittedAnswers[answerIndex].length <= 1999) {
        tempString += splittedAnswers[answerIndex++] + "\n";
        if (answerIndex === splittedAnswers.length) break;
      }
      answersList.push(tempString);
      tempString = "";
    }

    const firstMessage = `${message.author}\n\n${answersList[0]}`;
    if (message.channel.isThread()) await message.reply(firstMessage);
    else await thread.send(firstMessage);

    for (let i = 1; i < answersList.length; i++)
      await thread.send(answersList[i]);

    if (sources) {
      await thread.send(`\n\nVerified Sources:\n- ${sources.join("\n- ")}`);
    }
  } catch (error) {
    console.log(error);
    console.log("Something went wrong!");
  }
});

client.login(DISCORD_TOKEN);
