console.log("Starting bot...");

// ------------------------
// EXPRESS (KEEPS RENDER ALIVE)
// ------------------------
const express = require("express");
const app = express();

app.get("/", (req, res) => res.send("Bot is alive"));
app.listen(3000, () => console.log("Web server running"));

// ------------------------
// DISCORD IMPORTS
// ------------------------
const {
    Client,
    GatewayIntentBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionsBitField
} = require("discord.js");

const db = require("./database");

// TOKEN (SAFE)
const TOKEN = process.env.TOKEN;

// ------------------------
// CLIENT
// ------------------------
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ------------------------
// COOLDOWN
// ------------------------
const cooldowns = new Map();

function isOnCooldown(userId, cmd, time = 3000) {
    const key = `${userId}-${cmd}`;
    if (cooldowns.has(key)) return true;

    cooldowns.set(key, true);
    setTimeout(() => cooldowns.delete(key), time);
    return false;
}

// ------------------------
// USER SYSTEM
// ------------------------
function getUser(userId, cb) {
    db.get(`SELECT * FROM users WHERE user_id = ?`, [userId], (err, row) => {
        if (!row) {
            db.run(`INSERT INTO users (user_id, chips) VALUES (?, 1000)`, [userId]);
            return cb({ user_id: userId, chips: 1000 });
        }
        cb(row);
    });
}

function updateChips(userId, amount) {
    db.run(`
        UPDATE users 
        SET chips = chips + ? 
        WHERE user_id = ? AND chips + ? >= 0
    `, [amount, userId, amount]);
}

// ------------------------
// CLOVER
// ------------------------
function getClover(userId, cb) {
    db.get(`SELECT * FROM active_charms WHERE user_id = ? AND item = ?`, [userId, "Four Leaf Clover"], (err, row) => {
        cb(row);
    });
}

function useClover(userId) {
    db.get(`SELECT * FROM active_charms WHERE user_id = ? AND item = ?`, [userId, "Four Leaf Clover"], (err, row) => {
        if (!row) return;

        if (row.remaining_uses <= 1) {
            db.run(`DELETE FROM active_charms WHERE user_id = ? AND item = ?`, [userId, "Four Leaf Clover"]);
        } else {
            db.run(`UPDATE active_charms SET remaining_uses = remaining_uses - 1 WHERE user_id = ? AND item = ?`, [userId, "Four Leaf Clover"]);
        }
    });
}

// ------------------------
// BLACKJACK HELPERS
// ------------------------
const suits = ["♠","♥","♦","♣"];
const values = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];

function createDeck() {
    const deck = [];
    for (let suit of suits) {
        for (let value of values) {
            deck.push({suit, value});
        }
    }
    return deck.sort(() => Math.random() - 0.5);
}

function cardValue(card) {
    if (["J","Q","K"].includes(card.value)) return 10;
    if (card.value === "A") return 11;
    return parseInt(card.value);
}

function handValue(hand) {
    let total = 0;
    let aces = 0;

    for (let card of hand) {
        total += cardValue(card);
        if (card.value === "A") aces++;
    }

    while (total > 21 && aces > 0) {
        total -= 10;
        aces--;
    }

    return total;
}

function formatHand(hand) {
    return hand.map(c => `${c.value}${c.suit}`).join(", ");
}

// ------------------------
// MESSAGE EVENT
// ------------------------
client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    const args = message.content.split(" ");
    const cmd = args[0].toLowerCase();

    // BALANCE
    if (cmd === "!balance") {
        getUser(message.author.id, (u) => {
            message.reply(`💰 You have **${u.chips} chips**`);
        });
    }

    // SLOTS
    if (cmd === "!slots") {
        if (isOnCooldown(message.author.id, "slots")) return message.reply("⏳ Slow down!");

        const bet = parseInt(args[1]);
        if (!bet || bet <= 0) return message.reply("⚠️ Invalid bet!");

        getUser(message.author.id, (u) => {
            if (u.chips < bet) return message.reply("Not enough chips!");

            const symbols = ["🍒","🍋","💎","⭐"];
            const roll = [
                symbols[Math.floor(Math.random()*4)],
                symbols[Math.floor(Math.random()*4)],
                symbols[Math.floor(Math.random()*4)]
            ];

            let win = 0;

            if (roll[0] === roll[1] && roll[1] === roll[2]) win = bet * 5;
            else if (roll[0] === roll[1] || roll[1] === roll[2]) win = bet * 2;
            else win = -bet;

            getClover(message.author.id, (clover) => {
                if (clover && win > 0) {
                    win *= 2;
                    useClover(message.author.id);
                }

                updateChips(message.author.id, win);
                message.reply(`🎰 ${roll.join(" | ")}\nResult: ${win >= 0 ? "+" : ""}${win}`);
            });
        });
    }

    // BLACKJACK
    if (cmd === "!blackjack") {
        const bet = parseInt(args[1]);
        if (!bet || bet <= 0) return message.reply("Invalid bet!");

        getUser(message.author.id, (u) => {
            if (u.chips < bet) return message.reply("Not enough chips!");
            updateChips(message.author.id, -bet);

            let deck = createDeck();
            let player = [deck.pop(), deck.pop()];
            let dealer = [deck.pop(), deck.pop()];

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId("hit").setLabel("Hit").setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId("stand").setLabel("Stand").setStyle(ButtonStyle.Secondary)
            );

            message.reply({
                content: `🃏 ${formatHand(player)} (${handValue(player)})\nDealer: ${dealer[0].value}${dealer[0].suit}`,
                components: [row]
            }).then(msg => {
                const collector = msg.createMessageComponentCollector({ time: 60000 });

                collector.on("collect", i => {
                    if (i.user.id !== message.author.id) return;

                    if (i.customId === "hit") {
                        player.push(deck.pop());
                        const total = handValue(player);

                        if (total > 21) {
                            collector.stop();
                            i.update({ content: `💥 Bust! (${total})`, components: [] });
                        } else {
                            i.update({ content: `${formatHand(player)} (${total})`, components: [row] });
                        }
                    }

                    if (i.customId === "stand") {
                        collector.stop();

                        while (handValue(dealer) < 17) dealer.push(deck.pop());

                        const p = handValue(player);
                        const d = handValue(dealer);

                        let win = 0;
                        if (d > 21 || p > d) win = bet * 2;
                        else if (p === d) win = bet;

                        updateChips(message.author.id, win);

                        i.update({
                            content: `You: ${p} | Dealer: ${d}\nResult: ${win}`,
                            components: []
                        });
                    }
                });
            });
        });
    }

    // HOST GIVE CHIPS
    if (cmd === "!givechips") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply("Host only.");
        }

        const user = message.mentions.users.first();
        const amount = parseInt(args[2]);

        if (!user || isNaN(amount)) return message.reply("Usage: !givechips @user amount");

        updateChips(user.id, amount);
        message.reply(`Gave ${amount} chips`);
    }
});

// READY
client.once("ready", () => {
    console.log(`Logged in as ${client.user.tag}`);
});

// LOGIN
client.login(TOKEN).catch(err => {
    console.error("LOGIN ERROR:", err);
});
