const { Events, Collection, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { hasModPermission } = require('../../utils/helpers');
const db = require('../../database/connect');
const emojis = require('../../utils/emojis');

module.exports = {
    name: Events.InteractionCreate,
    /**
     * @param {import('discord.js').Interaction} interaction
     * @param {import('discord.js').Client} client
     */
    async execute(interaction, client) {
        if (interaction.isChatInputCommand() || interaction.isContextMenuCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) return;

            // Cooldowns
            const { cooldowns } = client;
            if (!cooldowns.has(command.data.name)) {
                cooldowns.set(command.data.name, new Collection());
            }

            const now = Date.now();
            const timestamps = cooldowns.get(command.data.name);
            const defaultCooldownDuration = 3;
            const cooldownAmount = (command.cooldown ?? defaultCooldownDuration) * 1000;

            if (timestamps.has(interaction.user.id)) {
                const expirationTime = timestamps.get(interaction.user.id) + cooldownAmount;
                if (now < expirationTime) {
                    const expiredTimestamp = Math.round(expirationTime / 1000);
                    return interaction.reply({
                        content: `${emojis.slowmode} يرجى الانتظار قليلاً! أنت في فترة تهدئة (Cooldown) لأمر \`${command.data.name}\`. يمكنك استخدامه مجدداً <t:${expiredTimestamp}:R>.`,
                        ephemeral: true
                    });
                }
            }

            timestamps.set(interaction.user.id, now);
            setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);

            try {
                await command.execute(interaction, client);
            } catch (error) {
                console.error(error);
                const errorMsg = `${emojis.error} حدث خطأ غير متوقع أثناء تنفيذ هذا الأمر!`;
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: errorMsg, ephemeral: true }).catch(() => {});
                } else {
                    await interaction.reply({ content: errorMsg, ephemeral: true }).catch(() => {});
                }
            }
        } else if (interaction.isButton()) {
            // Undo button in mod logs
            if (interaction.customId.startsWith('undo_')) {
                if (!hasModPermission(interaction.member)) {
                    return interaction.reply({
                        content: `${emojis.error} ليس لديك صلاحية لاستخدام زر التراجع.`,
                        ephemeral: true
                    });
                }

                const parts = interaction.customId.split('_');
                const action = parts[1];
                const caseNumber = parseInt(parts[2], 10);
                const targetUserId = parts[3];

                try {
                    if (action === 'mute') {
                        const targetMember = await interaction.guild.members.fetch(targetUserId).catch(() => null);
                        if (targetMember && targetMember.isCommunicationDisabled()) {
                            await targetMember.timeout(null, `Undo by ${interaction.user.tag}`);
                        }
                        db.deactivateCase(caseNumber, interaction.guild.id);
                    } else if (action === 'warn') {
                        db.deactivateCase(caseNumber, interaction.guild.id);
                        const userWarnings = db.getActiveWarnings(interaction.guild.id, targetUserId);
                        if (userWarnings.length > 0) {
                            db.deactivateWarning(userWarnings[0].id, interaction.guild.id);
                        }
                    }

                    const updatedRows = interaction.message.components.map(row => {
                        const newRow = ActionRowBuilder.from(row);
                        newRow.components = newRow.components.map(component => {
                            if (component.data.custom_id === interaction.customId) {
                                return ButtonBuilder.from(component)
                                    .setDisabled(true)
                                    .setStyle(ButtonStyle.Secondary)
                                    .setLabel(`تم التراجع (${interaction.user.username})`);
                            }
                            return component;
                        });
                        return newRow;
                    });

                    await interaction.update({ components: updatedRows }).catch(() => {});
                    return interaction.followUp({
                        content: `${emojis.success} تم التراجع عن إجراء (${action === 'mute' ? 'الكتم' : 'التحذير'}) بنجاح للمستخدم <@${targetUserId}>.`,
                        ephemeral: true
                    });
                } catch (error) {
                    console.error('Error in undo button:', error);
                    return interaction.reply({
                        content: `${emojis.error} حدث خطأ أثناء محاولة التراجع عن الإجراء.`,
                        ephemeral: true
                    });
                }
            }

            // Interactive Ticket System: Open Ticket
            if (interaction.customId === 'ticket_create') {
                const guildConfig = db.getConfig(interaction.guild.id);
                const existingTickets = db.getAllTickets(interaction.guild.id, 100);
                const openTicket = existingTickets.find(t => t.user_id === interaction.user.id && t.status === 'open');
                if (openTicket && interaction.guild.channels.cache.has(openTicket.channel_id)) {
                    return interaction.reply({
                        content: `${emojis.warn} لديك تكت مفتوح بالفعل في <#${openTicket.channel_id}>. يرجى إغلاقه قبل فتح تكت جديد.`,
                        ephemeral: true
                    });
                }

                await interaction.deferReply({ ephemeral: true });

                const permissionOverwrites = [
                    {
                        id: interaction.guild.id,
                        deny: [PermissionFlagsBits.ViewChannel]
                    },
                    {
                        id: interaction.user.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory,
                            PermissionFlagsBits.AttachFiles,
                            PermissionFlagsBits.EmbedLinks
                        ]
                    },
                    {
                        id: client.user.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ManageChannels,
                            PermissionFlagsBits.ReadMessageHistory
                        ]
                    }
                ];

                if (guildConfig.ticket_support_role_id) {
                    permissionOverwrites.push({
                        id: guildConfig.ticket_support_role_id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory,
                            PermissionFlagsBits.AttachFiles
                        ]
                    });
                }
                if (guildConfig.mod_role_id && guildConfig.mod_role_id !== guildConfig.ticket_support_role_id) {
                    permissionOverwrites.push({
                        id: guildConfig.mod_role_id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory
                        ]
                    });
                }

                try {
                    const cleanUsername = interaction.user.username.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'support';
                    const channelData = {
                        name: `ticket-${cleanUsername}`,
                        type: ChannelType.GuildText,
                        permissionOverwrites
                    };
                    if (guildConfig.ticket_category_id) {
                        const category = interaction.guild.channels.cache.get(guildConfig.ticket_category_id)
                            || await interaction.guild.channels.fetch(guildConfig.ticket_category_id).catch(() => null);
                        if (category && category.type === ChannelType.GuildCategory) {
                            channelData.parent = category.id;
                        }
                    }

                    const ticketChannel = await interaction.guild.channels.create(channelData);
                    const ticketRecord = db.createTicket(interaction.guild.id, ticketChannel.id, interaction.user.id);

                    const welcomeEmbed = new EmbedBuilder()
                        .setColor('#5865F2')
                        .setTitle(`${emojis.ticket} تكت الدعم الفني #${ticketRecord.ticketNumber}`)
                        .setDescription(`مرحباً ${interaction.user}! تم فتح هذا التكت لمساعدتك.\nيرجى كتابة استفسارك أو مشكلتك بالتفصيل وسيقوم فريق الدعم بالرد عليك في أقرب وقت.`)
                        .addFields(
                            { name: `${emojis.user} صاحب التكت`, value: `${interaction.user} (\`${interaction.user.id}\`)`, inline: true },
                            { name: `${emojis.calendar} تاريخ الفتح`, value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
                        )
                        .setFooter({ text: 'لإغلاق التكت اضغط على الزر الأحمر أدناه' })
                        .setTimestamp();

                    const ticketActionRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId('ticket_close')
                            .setLabel('إغلاق التكت')
                            .setEmoji(emojis.lock)
                            .setStyle(ButtonStyle.Danger),
                        new ButtonBuilder()
                            .setCustomId('ticket_transcript')
                            .setLabel('حفظ السجل (Transcript)')
                            .setEmoji(emojis.scroll)
                            .setStyle(ButtonStyle.Secondary)
                    );

                    await ticketChannel.send({
                        content: `${interaction.user} ${guildConfig.ticket_support_role_id ? `<@&${guildConfig.ticket_support_role_id}>` : ''}`,
                        embeds: [welcomeEmbed],
                        components: [ticketActionRow]
                    });

                    return interaction.followUp({
                        content: `${emojis.success} تم إنشاء التكت بنجاح! تفضل بالدخول إليه: ${ticketChannel}`,
                        ephemeral: true
                    });
                } catch (err) {
                    console.error('[Ticket Create] Error creating ticket:', err);
                    return interaction.followUp({
                        content: `${emojis.error} حدث خطأ أثناء محاولة إنشاء روم التكت. تأكد من صلاحية البوت في إدارة القنوات (Manage Channels).`,
                        ephemeral: true
                    });
                }
            }

            // Interactive Ticket System: Close Ticket
            if (interaction.customId === 'ticket_close') {
                const ticket = db.getTicketByChannel(interaction.channel.id);
                if (!ticket) {
                    return interaction.reply({
                        content: `${emojis.error} هذه القناة ليست مسجلة كتكت دعم فني نشط.`,
                        ephemeral: true
                    });
                }

                if (ticket.status === 'closed') {
                    return interaction.reply({
                        content: `${emojis.warn} هذا التكت مغلق بالفعل وجاري حذفها.`,
                        ephemeral: true
                    });
                }

                await interaction.reply({
                    content: `${emojis.lock} جاري إغلاق التكت، أرشفة السجل، وحذف القناة خلال 5 ثوانٍ...`
                });

                try {
                    const messages = await interaction.channel.messages.fetch({ limit: 100 }).catch(() => new Map());
                    const sorted = Array.from(messages.values()).reverse();

                    let transcript = `ModBot Ticket Transcript - #${ticket.ticket_number}\n`;
                    transcript += `Guild: ${interaction.guild.name} (${interaction.guild.id})\n`;
                    transcript += `Owner: ${ticket.user_id}\n`;
                    transcript += `Closed By: ${interaction.user.tag} (${interaction.user.id})\n`;
                    transcript += `Closed At: ${new Date().toISOString()}\n`;
                    transcript += `-------------------------------------------------------\n\n`;

                    for (const msg of sorted) {
                        const time = new Date(msg.createdTimestamp || Date.now()).toISOString();
                        const authorTag = msg.author?.tag || msg.author?.username || 'Unknown Author';
                        const authorId = msg.author?.id || 'Unknown';
                        transcript += `[${time}] ${authorTag} (${authorId}):\n${msg.content || '[Attachment / Embed]'}\n\n`;
                    }

                    db.closeTicket(interaction.channel.id, interaction.user.id, transcript);

                    const guildConfig = db.getConfig(interaction.guild.id);
                    if (guildConfig.log_channel_id) {
                        const logChannel = interaction.guild.channels.cache.get(guildConfig.log_channel_id);
                        if (logChannel && logChannel.isTextBased()) {
                            const buffer = Buffer.from(transcript, 'utf-8');
                            const file = new AttachmentBuilder(buffer, { name: `ticket-${ticket.ticket_number}-transcript.txt` });
                            const embed = new EmbedBuilder()
                                .setColor('#ED4245')
                                .setTitle(`${emojis.folder} أرشفة تكت #${ticket.ticket_number}`)
                                .setDescription(`تم إغلاق التكت بواسطة <@${interaction.user.id}>.\nصاحب التكت: <@${ticket.user_id}>`)
                                .setTimestamp();

                            await logChannel.send({ embeds: [embed], files: [file] }).catch(() => {});
                        }
                    }
                } catch (transcriptErr) {
                    console.error('[Ticket Close] Transcript error:', transcriptErr);
                }

                setTimeout(() => {
                    interaction.channel.delete('Ticket closed').catch(() => {});
                }, 5000).unref();
                return;
            }

            // Interactive Ticket System: Export Transcript
            if (interaction.customId === 'ticket_transcript') {
                await interaction.deferReply({ ephemeral: true });
                try {
                    const ticket = db.getTicketByChannel(interaction.channel.id);
                    const messages = await interaction.channel.messages.fetch({ limit: 100 }).catch(() => new Map());
                    const sorted = Array.from(messages.values()).reverse();

                    let transcript = `ModBot Ticket Transcript - #${ticket?.ticket_number || 'export'}\n`;
                    transcript += `Guild: ${interaction.guild.name} (${interaction.guild.id})\n`;
                    transcript += `Date: ${new Date().toISOString()}\n`;
                    transcript += `-------------------------------------------------------\n\n`;

                    for (const msg of sorted) {
                        const time = new Date(msg.createdTimestamp || Date.now()).toISOString();
                        const authorTag = msg.author?.tag || msg.author?.username || 'Unknown Author';
                        const authorId = msg.author?.id || 'Unknown';
                        transcript += `[${time}] ${authorTag} (${authorId}):\n${msg.content || '[Attachment / Embed]'}\n\n`;
                    }

                    const buffer = Buffer.from(transcript, 'utf-8');
                    const file = new AttachmentBuilder(buffer, { name: `ticket-transcript.txt` });

                    return interaction.followUp({
                        content: `${emojis.scroll} تفضل، تم استخراج نسخة من سجل المحادثات:`,
                        files: [file],
                        ephemeral: true
                    });
                } catch (err) {
                    console.error('[Ticket Transcript] Error:', err);
                    return interaction.followUp({
                        content: `${emojis.error} حدث خطأ أثناء محاولة حفظ السجل.`,
                        ephemeral: true
                    });
                }
            }

            // Self-Verification Click
            if (interaction.customId === 'verify_member') {
                const guildConfig = db.getConfig(interaction.guild.id);
                if (!guildConfig || !guildConfig.verify_role_id) {
                    return interaction.reply({
                        content: `${emojis.warn} لم يتم تحديد رتبة التوثيق في إعدادات السيرفر بعد. يرجى مراجعة إدارة السيرفر.`,
                        ephemeral: true
                    });
                }

                const role = interaction.guild.roles.cache.get(guildConfig.verify_role_id)
                    || await interaction.guild.roles.fetch(guildConfig.verify_role_id).catch(() => null);
                if (!role) {
                    return interaction.reply({
                        content: `${emojis.error} لم يتم العثور على رتبة التوثيق المحددة. يرجى التواصل مع الإدارة لتحديث الرتبة.`,
                        ephemeral: true
                    });
                }

                if (interaction.member.roles.cache.has(role.id)) {
                    return interaction.reply({
                        content: `${emojis.info} أنت حاصل بالفعل على رتبة العضوية المؤكدة!`,
                        ephemeral: true
                    });
                }

                try {
                    await interaction.member.roles.add(role, 'Self-Verification Click');
                    return interaction.reply({
                        content: `${emojis.party} تهانينا! تم تأكيد عضويتك بنجاح ومنحك رتبة ${role}. استمتع بوقتك في السيرفر!`,
                        ephemeral: true
                    });
                } catch (err) {
                    console.error('[Verify Click] Error adding role:', err);
                    return interaction.reply({
                        content: `${emojis.error} فشل منح الرتبة. تأكد من أن رتبة البوت أعلى من رتبة التوثيق في ترتيب الرتب بالسيرفر.`,
                        ephemeral: true
                    });
                }
            }

            // Interactive Self-Roles Toggle Button
            if (interaction.customId.startsWith('selfrole_toggle_')) {
                const roleId = interaction.customId.replace('selfrole_toggle_', '');
                const role = interaction.guild.roles.cache.get(roleId)
                    || await interaction.guild.roles.fetch(roleId).catch(() => null);

                if (!role) {
                    return interaction.reply({
                        content: `${emojis.error} لم يتم العثور على هذه الرتبة في السيرفر (ربما تم حذفها).`,
                        ephemeral: true
                    });
                }

                const me = interaction.guild.members.me;
                if (me && role.position >= me.roles.highest.position) {
                    return interaction.reply({
                        content: `${emojis.warn} رتبة البوت أدنى من هذه الرتبة في ترتيب رتب السيرفر، لذا لا يمكن للبوت تعديلها.`,
                        ephemeral: true
                    });
                }

                try {
                    if (interaction.member.roles.cache.has(role.id)) {
                        await interaction.member.roles.remove(role, 'Self-role removal via button panel');
                        return interaction.reply({
                            content: `${emojis.trash} تم إزالة رتبة ${role} من حسابك بنجاح.`,
                            ephemeral: true
                        });
                    } else {
                        await interaction.member.roles.add(role, 'Self-role claim via button panel');
                        return interaction.reply({
                            content: `${emojis.success} تم منحك رتبة ${role} بنجاح!`,
                            ephemeral: true
                        });
                    }
                } catch (roleErr) {
                    console.error('[SelfRole Toggle] Error:', roleErr);
                    return interaction.reply({
                        content: `${emojis.error} حدث خطأ أثناء محاولة تعديل الرتبة. تأكد من صلاحيات البوت.`,
                        ephemeral: true
                    });
                }
            }

            const button = client.buttons?.get(interaction.customId);
            if (!button) return;
            try {
                await button.execute(interaction, client);
            } catch (error) {
                console.error(error);
            }
        } else if (interaction.isStringSelectMenu()) {
            const selectMenu = client.selects?.get(interaction.customId);
            if (!selectMenu) return;
            try {
                await selectMenu.execute(interaction, client);
            } catch (error) {
                console.error(error);
            }
        } else if (interaction.isModalSubmit()) {
            const modal = client.modals?.get(interaction.customId);
            if (!modal) return;
            try {
                await modal.execute(interaction, client);
            } catch (error) {
                console.error(error);
            }
        }
    }
};
