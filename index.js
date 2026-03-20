console.log("Starting bot...");

const {
    Client,
    GatewayIntentBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");

const db = require("./database");
const config = require("./config");

const HOST_ROLE_NAME = "Host";
const DAILY_LIMIT = 20;

// ------------------------
// CLIENT
// ------------------------
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// ------------------------
// HELPERS
// ------------------------
function isHost(member) {
    return member.roles.cache.some(r => r.name === HOST_ROLE_NAME);
}

function getUser(id, cb) {
    db.get(`SELECT * FROM users WHERE user_id = ?`, [id], (err, row) => {
        if (!row) {
            db.run(`INSERT INTO users (user_id, chips) VALUES (?, 1000)`, [id]);
            return cb({ chips: 1000 });
        }
        cb(row);
    });
}

function updateChips(id, amount) {
    db.run(`UPDATE users SET chips = chips + ? WHERE user_id = ? AND chips + ? >= 0`,
        [amount, id, amount]);
}

// ------------------------
// DAILY LIMIT
// ------------------------
function canPlay(userId, message, cb) {
    if (isHost(message.member)) return cb(true);

    const now = Date.now();

    db.get(`SELECT * FROM daily_games WHERE user_id = ?`, [userId], (err, row) => {

        if (!row) {
            db.run(`INSERT INTO daily_games VALUES (?, ?, 0)`, [userId, now]);
            return cb(true);
        }

        if (now - row.last_reset > 86400000) {
            db.run(`UPDATE daily_games SET games_played = 0, last_reset = ? WHERE user_id = ?`,
                [now, userId]);
            return cb(true);
        }

        if (row.games_played >= DAILY_LIMIT) return cb(false);

        db.run(`UPDATE daily_games SET games_played = games_played + 1 WHERE user_id = ?`, [userId]);
        cb(true);
    });
}

// ------------------------
// CARD SYSTEM
// ------------------------
function drawCard() {
    const cards = [2,3,4,5,6,7,8,9,10,10,10,10,11];
    return cards[Math.floor(Math.random() * cards.length)];
}

function handValue(hand) {
    let total = hand.reduce((a,b)=>a+b,0);
    let aces = hand.filter(c=>c===11).length;

    while (total > 21 && aces > 0) {
        total -= 10;
        aces--;
    }
    return total;
}

// ------------------------
// EVENTS
// ------------------------
client.on("messageCreate", (message) => {
    if (message.author.bot) return;

    const args = message.content.split(" ");
    const cmd = args[0].toLowerCase();

    // 💰 BALANCE
    if (cmd === "!balance") {
        getUser(message.author.id, u => {
            message.reply(`💰 You have **${u.chips} chips**`);
        });
    }

    // 🎰 SLOTS
    if (cmd === "!slots") {
        canPlay(message.author.id, message, (ok) => {
            if (!ok) return message.reply("⛔ Daily limit reached!");

            const bet = parseInt(args[1]);
            if (!bet) return message.reply("⚠️ Enter a bet!");

            getUser(message.author.id, u => {
                if (u.chips < bet) return message.reply("❌ Not enough chips!");

                const s = ["🍒","🍋","💎","⭐"];
                const roll = [s[Math.random()*4|0],s[Math.random()*4|0],s[Math.random()*4|0]];

                let win = (roll[0]===roll[1]&&roll[1]===roll[2]) ? bet*5 :
                          (roll[0]===roll[1]||roll[1]===roll[2]) ? bet*2 : -bet;

                updateChips(message.author.id, win);

                message.reply(`🎰 ${roll.join(" | ")}\n${win>=0?"🎉 +":"💀 "}${win}`);
            });
        });
    }

    // 🃏 BLACKJACK
    if (cmd === "!blackjack") {
        canPlay(message.author.id, message, (ok) => {
            if (!ok) return message.reply("⛔ Daily limit reached!");

            const bet = parseInt(args[1]);
            if (!bet) return message.reply("⚠️ Enter a bet!");

            getUser(message.author.id, u => {
                if (u.chips < bet) return message.reply("❌ Not enough chips!");

                let player=[drawCard(),drawCard()];
                let dealer=[drawCard(),drawCard()];

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId("hit").setLabel("Hit").setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId("stand").setLabel("Stand").setStyle(ButtonStyle.Success)
                );

                message.reply({
                    content:`🃏 Blackjack\nYour: ${player} (${handValue(player)})\nDealer: ${dealer[0]}`,
                    components:[row]
                }).then(msg=>{

                    const collector = msg.createMessageComponentCollector({time:30000});

                    collector.on("collect", i=>{
                        if(i.user.id!==message.author.id) return;

                        if(i.customId==="hit"){
                            player.push(drawCard());
                            let val=handValue(player);

                            if(val>21){
                                updateChips(message.author.id,-bet);
                                collector.stop();
                                return i.update({content:`💥 Bust! (${val})`,components:[]});
                            }

                            i.update({content:`Your: ${player} (${val})\nDealer: ${dealer[0]}`,components:[row]});
                        }

                        if(i.customId==="stand"){
                            collector.stop();

                            while(handValue(dealer)<17) dealer.push(drawCard());

                            let p=handValue(player);
                            let d=handValue(dealer);

                            let win = p>d||d>21 ? bet : p<d ? -bet : 0;

                            updateChips(message.author.id,win);

                            i.update({content:`You: ${p} | Dealer: ${d}\n${win>0?"🎉 Win":"💀 Lose"}`,components:[]});
                        }
                    });
                });
            });
        });
    }

    // 🎡 ROULETTE
    if (cmd === "!roulette") {
        canPlay(message.author.id, message, (ok) => {
            if (!ok) return message.reply("⛔ Daily limit reached!");

            const bet = parseInt(args[1]);
            const choice = args[2];

            if (!bet || !choice) return message.reply("⚠️ Usage: !roulette <bet> <color/number>");

            getUser(message.author.id, u => {
                if (u.chips < bet) return message.reply("❌ Not enough chips!");

                const roll = Math.floor(Math.random()*37);
                const color = roll===0?"green":roll%2?"red":"black";

                let win=0;

                if(!isNaN(choice)){
                    win = parseInt(choice)===roll ? bet*35 : -bet;
                } else {
                    win = choice===color ? (color==="green"?bet*14:bet) : -bet;
                }

                updateChips(message.author.id,win);

                message.reply(`🎡 ${roll} (${color})\n${win>=0?"🎉 +":"💀 "}${win}`);
            });
        });
    }

    // 👑 GIVE CHIPS
    if (cmd === "!givechips") {
        if (!isHost(message.member)) return message.reply("⛔ Host only.");

        const user = message.mentions.users.first();
        const amount = parseInt(args[2]);

        if (!user || isNaN(amount)) return message.reply("❌ !givechips @user amount");

        updateChips(user.id, amount);
        message.reply(`👑 Gave ${amount} chips to ${user.username}`);
    }

    // 💀 TAKE CHIPS
    if (cmd === "!takechips") {
        if (!isHost(message.member)) return;

        const user = message.mentions.users.first();
        const amount = parseInt(args[2]);

        if (!user || isNaN(amount)) return;

        updateChips(user.id, -amount);
        message.reply(`💀 Took ${amount} chips`);
    }

    // ⚙️ SET CHIPS
    if (cmd === "!setchips") {
        if (!isHost(message.member)) return;

        const user = message.mentions.users.first();
        const amount = parseInt(args[2]);

        db.run(`UPDATE users SET chips=? WHERE user_id=?`, [amount, user.id]);

        message.reply(`⚙️ Set chips to ${amount}`);
    }

    // 🍀 USE (pending)
    if (cmd === "!use") {
        const item = args.slice(1).join(" ").toLowerCase();

        db.get(`SELECT * FROM inventory WHERE user_id=? AND item=?`,
        [message.author.id,item],(e,row)=>{
            if(!row||row.amount<=0) return message.reply("No item");

            db.run(`UPDATE inventory SET amount=amount-1 WHERE user_id=? AND item=?`,
            [message.author.id,item]);

            db.run(`INSERT INTO pending_charms (user_id,charm,status) VALUES (?,?,?)`,
            [message.author.id,item,"pending"]);

            message.reply("⏳ Waiting for host...");
        });
    }

    // 👑 APPROVE
    if (cmd === "!approvecharm") {
        if (!isHost(message.member)) return;

        const id = parseInt(args[1]);

        db.get(`SELECT * FROM pending_charms WHERE id=?`,[id],(e,row)=>{
            if(!row) return;

            db.run(`INSERT INTO active_charms VALUES (?,?,5)`,
            [row.user_id,row.charm]);

            db.run(`UPDATE pending_charms SET status='approved' WHERE id=?`,[id]);

            message.reply("✅ Approved");
        });
    }

    // ❌ DENY
    if (cmd === "!denycharm") {
        if (!isHost(message.member)) return;

        const id = parseInt(args[1]);
        db.run(`UPDATE pending_charms SET status='denied' WHERE id=?`,[id]);

        message.reply("❌ Denied");
    }

    // 📜 PENDING
    if (cmd === "!pendingcharms") {
        if (!isHost(message.member)) return;

        db.all(`SELECT * FROM pending_charms WHERE status='pending'`,(e,rows)=>{
            if(!rows.length) return message.reply("None");

            message.reply(rows.map(r=>`ID:${r.id} <@${r.user_id}> ${r.charm}`).join("\n"));
        });
    }
});

// READY
client.once("ready", () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.login(config.token);
