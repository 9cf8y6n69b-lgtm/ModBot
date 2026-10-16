const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ComponentType
} = require('discord.js');
const emojis = require('../../utils/emojis');

// ───── تصنيفات الأوامر والبيانات التفصيلية ─────
const CATEGORIES = {
    moderation: {
        id: 'moderation',
        label: 'أوامر الإشراف والعقوبات',
        emoji: emojis.shield,
        description: 'حظر، طرد، كتم، إنذارات، السجل الجنائي الشامل، وقفل الرومات ومسح الشات',
        sections: [
            {
                title: `${emojis.ban} أوامر العقوبات والإبعاد (Sanctions)`,
                commands: [
                    { name: '/ban', usage: '/ban [عضو] [سبب] [أيام المسح]', desc: 'حظر عضو نهائياً من السيرفر وتطهير رسائله السابقة.' },
                    { name: '/softban', usage: '/softban [عضو] [سبب] [أيام المسح]', desc: 'حظر خفيف وإلغاء الحظر فوراً لتطهير الرسائل دون حظر دائم.' },
                    { name: '/kick', usage: '/kick [عضو] [سبب]', desc: 'طرد العضو من السيرفر مع إمكانية رجوعه برابط دعوة جديد.' },
                    { name: '/mute', usage: '/mute [عضو] [المدة] [سبب]', desc: 'كتم مؤقت (Timeout) لمنع العضو من التحدث أو المشاركة.' },
                    { name: '/unmute', usage: '/unmute [عضو] [سبب]', desc: 'إلغاء الكتم وإعادة كافة صلاحيات المشاركة للعضو فوراً.' },
                    { name: '/unban', usage: '/unban [آيدي العضو] [سبب]', desc: 'إلغاء حظر عضو محظور سابقاً بواسطة الـ ID الخاص به.' },
                ]
            },
            {
                title: `${emojis.case} سجل الإنذارات والقضايا (Warns & Cases)`,
                commands: [
                    { name: '/warn', usage: '/warn [عضو] [سبب]', desc: 'إعطاء إنذار رسمي مسجل في قاعدة البيانات مع إشعار بالخاص.' },
                    { name: '/warnings', usage: '/warnings [عضو]', desc: 'استعراض قائمة الإنذارات النشطة والموثقة لعضو محدد.' },
                    { name: '/removewarn', usage: '/removewarn [عضو] [رقم التحذير]', desc: 'إزالة تحذير معين من سجل العضو بواسطة معرّفه.' },
                    { name: '/search-user', usage: '/search-user [عضو/آيدي]', desc: 'فحص إشرافي شامل لملف العضو، السجل الجنائي، والتكتات.' },
                    { name: '/case', usage: '/case [رقم القضية] [تعديل السبب]', desc: 'استعراض أو تحديث بيانات قضية إشرافية سابقة في السجل.' },
                ]
            },
            {
                title: `${emojis.lock} إدارة القنوات وتنظيف الشات (Chat Controls)`,
                commands: [
                    { name: '/purge', usage: '/purge [العدد] [عضو اختياري]', desc: 'مسح جماعي سريع لرسائل الروم مع دعم فلترة عضو معين.' },
                    { name: '/lockdown', usage: '/lockdown [سبب اختياري]', desc: 'إغلاق القناة الحالية فوراً ومنع الأعضاء من الكتابة.' },
                    { name: '/unlock', usage: '/unlock', desc: 'إعادة فتح القناة الحالية والسماح للأعضاء بالكتابة مجدداً.' },
                    { name: '/slowmode', usage: '/slowmode [الثواني]', desc: 'تحديد مهلة الانتظار بين الرسائل لتهدئة الشات والحد من السبام.' },
                ]
            }
        ],
        footerNote: `${emojis.ping} جميع أوامر الإشراف تتطلب رتبة إشرافية وتُسجل لحظياً في رومات اللوق وقاعدة بيانات السيرفر.`
    },

    config: {
        id: 'config',
        label: 'الضبط والبروتكشن المتقدم',
        emoji: emojis.settings,
        description: 'إعدادات البوت، درع الأوتومود، التكتات، والتوثيق الذاتي',
        sections: [
            {
                title: `${emojis.shield} أنظمة الحماية والأوتومود (Security)`,
                commands: [
                    { name: '/automod', usage: '/automod [الحالة] [الحدود]', desc: 'التحكم في فلاتر الروابط، السبام، مكافحة التخريب (Anti-Nuke)، وعزل النصابين.' },
                    { name: '/setup', usage: '/setup [قناة اللوق] [رتبة المشرف]...', desc: 'إعداد وتعيين قنوات السجلات الإشرافية ورتب التحكم الأساسية.' },
                ]
            },
            {
                title: `${emojis.ticket} التكتات والتفاعل الذاتي (Interactive Panels)`,
                commands: [
                    { name: '/ticket-panel', usage: '/ticket-panel [القناة] [العنوان]', desc: 'نشر لوحة تفاعلية بأزرار لفتح تكتات الدعم الفني والبلاغات المنظمة.' },
                    { name: '/verify-setup', usage: '/verify-setup [القناة] [رتبة الموثق]', desc: 'نشر زر تحقق تلقائي يمنح العضو الرتبة المحددة بمجرد الضغط عليه.' },
                    { name: '/selfrole-panel', usage: '/selfrole-panel [القناة] [الرتب]', desc: 'نشر لوحة أزرار رتب ذاتية تتيح للأعضاء اختيار رتبهم بأنفسهم.' },
                ]
            }
        ],
        footerNote: `${emojis.lock} أوامر الإعداد مخصصة لمالك السيرفر ومسؤولي الإدارة العليا فقط لضمان أمان السيرفر.`
    },

    general: {
        id: 'general',
        label: 'الأوامر العامة والتفاعل',
        emoji: emojis.pin,
        description: 'صدارة التفاعل، معلومات السيرفر والبوت، ومستوى البوست',
        sections: [
            {
                title: `${emojis.sparkles} أدوات المجتمع والنشاط (Community)`,
                commands: [
                    { name: '/top-members', usage: '/top-members', desc: 'عرض لوحة صدارة أكثر الأعضاء إرسالاً وتفاعلاً في السيرفر.' },
                    { name: '/boost', usage: '/boost', desc: 'استعراض إحصائيات تعزيز السيرفر (Nitro Boosts) وقائمة الداعمين.' },
                    { name: '/userinfo', usage: '/userinfo [عضو اختياري]', desc: 'عرض تفاصيل الحساب، تاريخ الإنضمام، ورتب العضو الحالية.' },
                    { name: '/serverinfo', usage: '/serverinfo', desc: 'معلومات شاملة عن السيرفر، المالك، عدد الأعضاء، والرومات.' },
                ]
            },
            {
                title: `${emojis.bot} نظام البوت والمساعدة (System)`,
                commands: [
                    { name: '/ping', usage: '/ping', desc: 'فحص سرعة استجابة البوت واتصاله ببوابة ديسكورد بالمللي ثانية.' },
                    { name: '/botinfo', usage: '/botinfo', desc: 'معلومات تقنية تفصيلية عن البوت، الذاكرة، ووقت التشغيل (Uptime).' },
                    { name: '/help', usage: '/help', desc: 'فتح دليل الأوامر التفاعلي المنسق (القائمة الحالية).' },
                ]
            }
        ],
        footerNote: `${emojis.sparkles} أوامر عامة متاحة لجميع الأعضاء بدون الحاجة لأي رتب خاصة.`
    },

    context: {
        id: 'context',
        label: 'تطبيقات كليك يمين (Apps)',
        emoji: emojis.apps,
        description: 'إجراءات سريعة بالزر الأيمن على الأعضاء أو الرسائل مباشرة دون كتابة',
        sections: [
            {
                title: `${emojis.ping} إجراءات سريعة وفورية (Context Menu Apps)`,
                commands: [
                    { name: 'Delete & Warn', usage: 'كليك يمين على الرسالة ← Apps', desc: 'حذف الرسالة المخالفة فورياً وتسجيل إنذار على صاحبها بضغطة زر.' },
                    { name: 'Quick Mute (10m)', usage: 'كليك يمين على العضو ← Apps', desc: 'كتم العضو مؤقتاً لمدة 10 دقائق فورية لإيقاف الشغب السريع.' },
                    { name: 'View Warnings', usage: 'كليك يمين على العضو ← Apps', desc: 'عرض بطاقة تحتوي على كافة التحذيرات النشطة المسجلة للعضو.' },
                    { name: 'Check User History', usage: 'كليك يمين على العضو ← Apps', desc: 'فتح السجل الإشرافي الشامل للعضو: الإنذارات، القضايا، والتكتات.' },
                ]
            }
        ],
        footerNote: `${emojis.info} للوصول إليها: اضغط بالزر الأيمن على أي رسالة أو عضو (أو اضغط مطولاً في تطبيق الهاتف) واختر Apps.`
    }
};

// ───── بناء الواجهة الرئيسية (Main Dashboard Embed) ─────
function buildMainEmbed(client, guild) {
    const totalCmds = Object.values(CATEGORIES).reduce((acc, cat) => {
        return acc + cat.sections.reduce((sAcc, s) => sAcc + s.commands.length, 0);
    }, 0);

    const descLines = [
        `## ${emojis.shield} مركز مساعدة وأوامر ${client.user.username}`,
        `> **ModBot** نظام حماية ورقابة ذكي متكامل مصمم لحماية وإدارة مجتمعات ديسكورد بأعلى معايير الأمان والسرعة.`,
        '',
        `### ${emojis.case} التصنيفات المتوفرة (${totalCmds} أمراً واختصاراً):`,
        `* ${emojis.shield} **\`أوامر الإشراف والعقوبات\`** • **15 أمر**`,
        `  -# حظر، كتم، طرد، إنذارات، السجل الجنائي الشامل، وقفل الرومات ومسح الشات.`,
        `* ${emojis.settings} **\`الضبط والبروتكشن المتقدم\`** • **5 أوامر**`,
        `  -# فلتر الأوتومود، درع مكافحة التخريب (Anti-Nuke)، عزل النصابين، والتكتات والتوثيق.`,
        `* ${emojis.pin} **\`الأوامر العامة والتفاعل\`** • **7 أوامر**`,
        `  -# صدارة التفاعل، إحصائيات البوست، معلومات السيرفر، وسرعة الاستجابة.`,
        `* ${emojis.apps} **\`تطبيقات كليك يمين (Apps)\`** • **4 اختصارات**`,
        `  -# إجراءات إشرافية وفحص فوري عبر الضغط بالزر الأيمن على الأعضاء أو الرسائل.`,
        '',
        `### ${emojis.link} لوحة التحكم الذكية:`,
        `> يمكنك إدارة جميع هذه الإعدادات وتخصيص البوت بصرياً عبر:`,
        `> ${emojis.link} **[لوحة التحكم السحابية (Dashboard)](http://localhost:3000)**`,
        '',
        `-# ${emojis.info} **تلميح:** اختر القسم الذي تريده من القائمة المنسدلة بالأسفل لعرض تفاصيل كل أمر وطريقة استخدامه.`
    ].join('\n');

    return new EmbedBuilder()
        .setAuthor({
            name: `${client.user.username} • دليل الأوامر الشامل`,
            iconURL: client.user.displayAvatarURL()
        })
        .setDescription(descLines)
        .setColor(0x5865F2)
        .setThumbnail(client.user.displayAvatarURL({ dynamic: true }))
        .setFooter({
            text: `${guild ? guild.name : 'ModBot'} • الإصدار المحدّث 2026`,
            iconURL: guild?.iconURL() || client.user.displayAvatarURL()
        })
        .setTimestamp();
}

// ───── بناء واجهة القسم التفصيلية (Category Details Embed) ─────
function buildCategoryEmbed(cat, client, guild) {
    const totalInCat = cat.sections.reduce((acc, s) => acc + s.commands.length, 0);

    const descLines = [
        `## ${cat.emoji} ${cat.label} \`(${totalInCat} أمر)\``,
        `> ${cat.description}`,
        ''
    ];

    cat.sections.forEach(sec => {
        descLines.push(`### ${sec.title}`);
        sec.commands.forEach(cmd => {
            descLines.push(`> \`${cmd.name}\` • **${cmd.desc}**`);
            descLines.push(`> \`الاستخدام:\` \`${cmd.usage}\``);
            descLines.push('');
        });
    });

    if (cat.footerNote) {
        descLines.push(`-# ${cat.footerNote}`);
    }

    return new EmbedBuilder()
        .setAuthor({
            name: `${client.user.username} • قسم ${cat.label}`,
            iconURL: client.user.displayAvatarURL()
        })
        .setDescription(descLines.join('\n'))
        .setColor(0x5865F2)
        .setThumbnail(client.user.displayAvatarURL({ dynamic: true }))
        .setFooter({
            text: `${guild ? guild.name : 'ModBot'} • استخدم القائمة للتبديل بين الأقسام`,
            iconURL: guild?.iconURL() || client.user.displayAvatarURL()
        })
        .setTimestamp();
}

// ───── بناء السلكت منيو التفاعلي ─────
function buildSelectMenu(selected) {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('help_select')
            .setPlaceholder('اضغط هنا لاختيار قسم الأوامر...')
            .addOptions([
                {
                    label: 'الصفحة الرئيسية',
                    value: 'home',
                    description: 'العودة لواجهة دليل الأوامر الرئيسية',
                    emoji: emojis.home,
                    default: selected === 'home',
                },
                ...Object.values(CATEGORIES).map(c => ({
                    label: c.label,
                    value: c.id,
                    description: c.description.slice(0, 100),
                    emoji: c.emoji,
                    default: selected === c.id,
                })),
            ])
    );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('عرض دليل الأوامر التفاعلي المنسق والشامل للبوت'),

    async execute(interaction) {
        const embed = buildMainEmbed(interaction.client, interaction.guild);
        const row = buildSelectMenu('home');

        await interaction.reply({
            embeds: [embed],
            components: [row]
        });

        const replyMsg = await interaction.fetchReply();

        const collector = replyMsg.createMessageComponentCollector({
            componentType: ComponentType.StringSelect,
            time: 120_000,
        });

        collector.on('collect', async i => {
            if (i.user.id !== interaction.user.id) {
                return i.reply({
                    content: `${emojis.error} هذه القائمة التفاعلية مخصصة لصاحب الأمر فقط. يمكنك كتابة \`/help\` لفتح قائمتك الخاصة.`,
                    ephemeral: true
                });
            }

            const value = i.values[0];
            if (value === 'home') {
                await i.update({
                    embeds: [buildMainEmbed(interaction.client, interaction.guild)],
                    components: [buildSelectMenu('home')]
                });
            } else {
                const cat = CATEGORIES[value];
                if (!cat) return;
                await i.update({
                    embeds: [buildCategoryEmbed(cat, interaction.client, interaction.guild)],
                    components: [buildSelectMenu(value)]
                });
            }
        });

        collector.on('end', () => {
            const disabledRow = new ActionRowBuilder().addComponents(
                StringSelectMenuBuilder.from(row.components[0]).setDisabled(true)
            );
            replyMsg.edit({ components: [disabledRow] }).catch(() => {});
        });
    },
};
