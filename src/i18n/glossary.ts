import type { Locale } from '../lib/i18n';

export type GlossaryText = Record<Locale, string>;
export interface GlossarySource { label: GlossaryText; url: string; }
export interface GlossaryEntry {
  id: string;
  title: GlossaryText;
  original: string;
  language: 'en' | 'zh' | 'mi';
  origin: GlossaryText;
  pronunciation: { text: GlossaryText; source: GlossarySource };
  summary: GlossaryText;
  context: GlossaryText;
  related: { path: string; label: GlossaryText };
  sources: readonly GlossarySource[];
}

// Editorial definitions, not quoted dictionary translations. Sources checked 2026-09-05.
export const glossaryEntries: readonly GlossaryEntry[] = [
  {
    id: 'jade', title: { ru: 'Jade', en: 'Jade' }, original: 'jade', language: 'en',
    origin: { ru: 'Английский · название материала', en: 'English · material name' },
    pronunciation: {
      text: { ru: '/dʒeɪd/ · английское произношение', en: '/dʒeɪd/ · English pronunciation' },
      source: { label: { ru: 'Произношение · Cambridge Dictionary', en: 'Pronunciation · Cambridge Dictionary' }, url: 'https://dictionary.cambridge.org/pronunciation/english/jade' },
    },
    summary: {
      ru: 'Собирательное название прежде всего для нефрита и жадеита, а не имя одного минерала. В современной геммологии GIA при определённых условиях включает сюда также зелёный омфацит.',
      en: 'An umbrella name chiefly for nephrite and jadeite, not a single mineral. In modern gemmology, GIA also includes green omphacite under certain conditions.',
    },
    context: {
      ru: 'На YU в центре внимания нефрит и жадеит. Общего имени и похожего цвета недостаточно, чтобы считать их одним материалом; jade бывает не только зелёным.',
      en: 'YU focuses on nephrite and jadeite. A shared name and similar colour do not make them the same material; jade is not always green.',
    },
    related: { path: '/material/', label: { ru: 'Сравнить материалы', en: 'Compare the materials' } },
    sources: [{ label: { ru: 'GIA · что называют jade', en: 'GIA · what the name jade includes' }, url: 'https://www.gia.edu/jade-description' }],
  },
  {
    id: 'nephrite', title: { ru: 'Нефрит', en: 'Nephrite' }, original: 'nephrite', language: 'en',
    origin: { ru: 'Английский термин · нефрит', en: 'English · nephrite' },
    pronunciation: {
      text: { ru: '/ˈnef.raɪt/ · английское произношение', en: '/ˈnef.raɪt/ · English pronunciation' },
      source: { label: { ru: 'Произношение · Cambridge Dictionary', en: 'Pronunciation · Cambridge Dictionary' }, url: 'https://dictionary.cambridge.org/pronunciation/english/nephrite' },
    },
    summary: {
      ru: 'Материал из тесно переплетённых кристаллов амфиболов ряда тремолит–актинолит. Один из основных материалов, называемых jade; отличается от жадеита составом и структурой.',
      en: 'A material of tightly interwoven tremolite–actinolite amphibole crystals. One of the main materials called jade, it differs from jadeite in composition and structure.',
    },
    context: {
      ru: 'Волокнистое переплетение помогает объяснить его высокую ударную вязкость. Это не то же самое, что твёрдость — сопротивление царапанию.',
      en: 'Its interwoven fibrous structure helps explain its high toughness. Toughness is not the same property as hardness, or resistance to scratching.',
    },
    related: { path: '/material/#material-lens', label: { ru: 'Рассмотреть волокнистую схему', en: 'Explore the fibrous structure' } },
    sources: [{ label: { ru: 'GIA · The Jade Enigma, 1982 (PDF)', en: 'GIA · The Jade Enigma, 1982 (PDF)' }, url: 'https://www.gia.edu/doc/The-Jade-Enigma.pdf' }],
  },
  {
    id: 'jadeite', title: { ru: 'Жадеит', en: 'Jadeite' }, original: 'jadeite', language: 'en',
    origin: { ru: 'Английский термин · жадеит', en: 'English · jadeite' },
    pronunciation: {
      text: { ru: '/ˈdʒeɪdaɪt/ · британское произношение', en: '/ˈdʒeɪdaɪt/ · British English pronunciation' },
      source: { label: { ru: 'Произношение · Collins Dictionary', en: 'Pronunciation · Collins Dictionary' }, url: 'https://www.collinsdictionary.com/dictionary/english/jadeite' },
    },
    summary: {
      ru: 'Жадеит — минерал группы пироксенов. Поделочный jadeite jade представляет собой плотный агрегат кристаллов; это другой материал, не разновидность нефрита.',
      en: 'Jadeite is a pyroxene mineral. The carving material jadeite jade is a compact aggregate of crystals: a different material, not a variety of nephrite.',
    },
    context: {
      ru: 'Зелёный цвет не является определением жадеита: встречаются белые, лавандовые и другие оттенки. Для определения образца одного цвета недостаточно.',
      en: 'Green does not define jadeite: white, lavender and other colours occur. Colour alone is not enough to identify a specimen.',
    },
    related: { path: '/material/#material-lens', label: { ru: 'Сравнить зёрна и волокна', en: 'Compare grains and fibres' } },
    sources: [
      { label: { ru: 'GIA · Jade Description', en: 'GIA · Jade Description' }, url: 'https://www.gia.edu/jade-description' },
      { label: { ru: 'Merriam-Webster · минерал jadeite', en: 'Merriam-Webster · the mineral jadeite' }, url: 'https://www.merriam-webster.com/dictionary/jadeite' },
    ],
  },
  {
    id: 'yu', title: { ru: 'Юй · yù', en: 'Yù' }, original: '玉', language: 'zh',
    origin: { ru: 'Китайский · слово и культурный образ', en: 'Chinese · word and cultural idea' },
    pronunciation: {
      text: { ru: 'yù · пиньинь, четвёртый тон', en: 'yù · pinyin, fourth tone' },
      source: { label: { ru: 'Чтение 玉 · словарь Министерства образования Тайваня', en: 'Reading 玉 · Taiwan Ministry of Education dictionary' }, url: 'https://dict.revised.moe.edu.tw/dictView.jsp?ID=11670&la=1&powerMode=0' },
    },
    summary: {
      ru: 'Китайское слово, часто переводимое как jade. Помимо названия драгоценного материала, 玉 входит в выражения о красоте, ценности и изысканности.',
      en: 'A Chinese word often translated as jade. Beyond naming a precious material, 玉 appears in expressions of beauty, value and refinement.',
    },
    context: {
      ru: 'Юй — не точный синоним одного минерала. В историческом тексте это слово нужно читать в контексте; материал конкретного предмета проверяют отдельно по музейным или лабораторным данным.',
      en: 'Yù is not an exact synonym for one mineral. Read it in the context of a historical text; establish an individual object’s material separately from museum or laboratory evidence.',
    },
    related: { path: '/mythology/#legend-history', label: { ru: 'Проследить историю слова в легенде', en: 'Follow the word through a legend' } },
    sources: [{ label: { ru: 'Значения 玉 · словарь Министерства образования Тайваня', en: 'Meanings of 玉 · Taiwan Ministry of Education dictionary' }, url: 'https://dict.revised.moe.edu.tw/dictView.jsp?ID=11670&la=1&powerMode=0' }],
  },
  {
    id: 'bi', title: { ru: 'Би · bì', en: 'Bì · bi disk' }, original: '璧', language: 'zh',
    origin: { ru: 'Китайский · форма предмета', en: 'Chinese · object form' },
    pronunciation: {
      text: { ru: 'bì · пиньинь, четвёртый тон', en: 'bì · pinyin, fourth tone' },
      source: { label: { ru: 'Чтение 璧 · словарь Министерства образования Тайваня', en: 'Reading 璧 · Taiwan Ministry of Education dictionary' }, url: 'https://dict.mini.moe.edu.tw/SearchIndex/searchResult?dictSearchField=%E7%92%A7&searchType=one' },
    },
    summary: {
      ru: 'Круглый диск из jade с отверстием в центре. Это название формы предмета, а не отдельного минерала; музейный bi на YU изготовлен из нефрита.',
      en: 'A circular jade disk with a central opening. The word names an object form, not a mineral; the museum bi featured on YU is nephrite.',
    },
    context: {
      ru: 'Met связывает подобные неолитические диски с возможным ритуальным использованием или высоким статусом. Форма сама по себе не доказывает единственного значения символа.',
      en: 'The Met connects such Neolithic disks with possible ritual use or high status. The form alone does not establish a single symbolic meaning.',
    },
    related: { path: '/history/#object-biography', label: { ru: 'Рассмотреть диск Met 17.118.43', en: 'Examine Met disk 17.118.43' } },
    sources: [{ label: { ru: 'The Met · Annular disk (bi), 17.118.43', en: 'The Met · Annular disk (bi), 17.118.43' }, url: 'https://www.metmuseum.org/art/collection/search/49371' }],
  },
  {
    id: 'pounamu', title: { ru: 'Pounamu', en: 'Pounamu' }, original: 'pounamu', language: 'mi',
    origin: { ru: 'Te reo Māori · Аотеароа, Новая Зеландия', en: 'Te reo Māori · Aotearoa New Zealand' },
    pronunciation: {
      text: { ru: 'Произношение на языке маори — запись по ссылке', en: 'Māori pronunciation — follow the recording link' },
      source: { label: { ru: 'Послушать pounamu · Tātai Aho Rau', en: 'Hear pounamu · Tātai Aho Rau' }, url: 'https://core-ed.org/en_NZ/free-resources/te-wiki-o-te-reo-kete/' },
    },
    summary: {
      ru: 'Маорийское название ценимого камня, известного также как greenstone. По Te Ara, включает нефрит и боуэнит: поэтому pounamu не является точным синонимом ни jade, ни нефрита.',
      en: 'A Māori name for the treasured stone also known as greenstone. Te Ara includes nephrite and bowenite: pounamu is therefore not an exact synonym for either jade or nephrite.',
    },
    context: {
      ru: 'Pounamu связан с людьми, местами и передаваемыми историями. Te Papa показывает его роль в родственных отношениях, дарах и заключении мира — не только как поделочного сырья.',
      en: 'Pounamu connects people, places and inherited stories. Te Papa describes its role in relationships, gifts and peacemaking, not merely as a raw material for carving.',
    },
    related: { path: '/mythology/', label: { ru: 'Читать о Поутини и pounamu', en: 'Read about Poutini and pounamu' } },
    sources: [
      { label: { ru: 'Te Ara · разные названия pounamu', en: 'Te Ara · the names and materials of pounamu' }, url: 'https://teara.govt.nz/en/pounamu-jade-or-greenstone/page-1' },
      { label: { ru: 'Te Papa · укрепление отношений', en: 'Te Papa · strengthening relationships' }, url: 'https://collections.tepapa.govt.nz/topic/1979' },
      { label: { ru: 'Te Aka · pounamu в словаре маори', en: 'Te Aka · Māori dictionary entry' }, url: 'https://maoridictionary.co.nz/search?keywords=pounamu' },
    ],
  },
];
