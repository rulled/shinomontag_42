const { Bot, Keyboard } = require("grammy");
const { config } = require("./config");
const { attachBot } = require("./services/notifyService");

function createBot() {
  if (!config.botToken) {
    console.warn("[telegram] BOT_TOKEN не задан. Бот и уведомления отключены.");
    return null;
  }

  const bot = new Bot(config.botToken);

  const appKeyboard = new Keyboard()
    .webApp("Открыть запись", config.miniAppUrl)
    .resized();

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Запись на шиномонтаж. Нажмите кнопку ниже, чтобы открыть Mini App.",
      { reply_markup: appKeyboard }
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      "Команды:\n/start - открыть Mini App\n/help - справка",
      { reply_markup: appKeyboard }
    );
  });

  bot.catch((error) => {
    console.error("[telegram] bot error:", error.error);
  });

  attachBot(bot);
  return bot;
}

async function startBot(bot) {
  if (!bot) return;
  await bot.start({ onStart: () => console.log("[telegram] bot polling started") });
}

module.exports = {
  createBot,
  startBot,
};
