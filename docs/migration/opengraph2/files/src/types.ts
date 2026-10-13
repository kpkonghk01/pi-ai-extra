export interface OGImage {
  id: string;
  url: string;
  ratio: string;
  cost: number;
  tokens: number;
  model: string;
  timestamp: string;
}

export interface TokenLog {
  id: string;
  model: string;
  tokens: number;
  costHkd: number;
  timestamp: string;
  description: string;
}

export interface TemplatePresetSet {
  id: number;
  name: string;
  images: string[];
  updatedAt?: string;
}

export interface AppState {
  templateImage: string | null;
  templateImages: string[];
  activeTemplateIndex: number | null;
  cloneTemplateTypography: boolean;
  antiTextStroke: boolean;
  sourceImages: string[];
  brandLogo: string | null;
  prohibitPretrainedBrandData: boolean;
  prompt: string;
  selectedRatios: string[];
  /** Canonical image model ID, `provider:familyId` (for example 'google:gemini-nano-banana-2.1'). */
  selectedModel: string;
  layoutPrompts: Record<string, string>;
  temperature: number;
  
  // Manga mode
  isMangaMode: boolean;
  isCustomMangaMode: boolean;
  customMangaPrompt: string;
  selectedMangaStyle: string | null;
  selectedMangaArtist: string | null;
}

export const WHITELIST = [
  "ai@hk01.com.hk", "wlhong@allo.hk", "skchum@hk01.com", "mansonkin@gmail.com", "shuiyung@hk01.com",
  "bachlau@hk01.com", "garycheung@hk01.com", "ytyip@hk01.com", "karsonso@hk01.com",
  "kennethlam@hk01.com", "skchung@hk01.com", "philiplaw@hk01.com", "dinnieyuen@hk01.com",
  "mandychow@hk01.com", "dilyschan@hk01.com", "samuelpoon@hk01.com", "growtheditor@hk01.com",
  "ivanha@hk01.com", "conradcheng@hk01.com", "rickyyim@hk01.com", "erickoon@hk01.com",
  "stephenchu@hk01.com", "johnsiu@hk01.com", "nicoletang@hk01.com", "annahui@hk01.com",
  "adang@hk01.com", "jeffreyli@hk01.com", "leong@hk01.com", "carinalam@hk01.com",
  "melodycheung@hk01.com", "szeleung@hk01.com", "elsang@hk01.com", "fyli@hk01.com",
  "edwinyiu@hk01.com", "johnho@hk01.com", "blazotang@hk01.com", "peggiehung@hk01.com",
  "bluelo@hk01.com", "raycheung@hk01.com", "helenleung@hk01.com", "cococheung@hk01.com",
  "amberso@hk01.com", "jennychan@hk01.com", "digiops@hk01.com", "kenchow@hk01.com",
  "cmsuser09@hk01.com"
];

export const RATIO_OPTIONS = [
  { id: '16:9', label: '1200 x 675px (16:9)', width: 1200, height: 675 },
  { id: '4:5', label: '1200 x 1500px (4:5)', width: 1200, height: 1500 },
  { id: '1:1', label: '1200 x 1200px (1:1)', width: 1200, height: 1200 },
  { id: '9:16', label: '675 x 1200px (9:16)', width: 675, height: 1200 },
  { id: '3:4', label: '1242 x 1660 px（3:4）', width: 1242, height: 1660 },
  { id: '300x250', label: '300 x 250px（廣告專用）', width: 300, height: 250 },
  { id: '336x280', label: '336 x 280px（廣告專用）', width: 336, height: 280 },
  { id: '300x600', label: '300 x 600px（廣告專用）', width: 300, height: 600 },
  { id: '320x480', label: '320 x 480px（廣告專用）', width: 320, height: 480 },
  { id: '300x300', label: '300 x 300px（廣告專用B）', width: 300, height: 300 },
];

/** Default image model. The model list itself comes from the server (GET /api/image-models). */
export const DEFAULT_IMAGE_MODEL_ID = 'google:gemini-nano-banana-2.1';

/** Converts the models' USD price estimates (server/imageModels.ts) to the HKD shown in the app. */
export const USD_TO_HKD = 7.8;

export const BASIC_MANGA_STYLES = [
  {
    id: 'bw_classic',
    name: '黑白經典日漫風',
    prompt: '【黑白經典日漫風格】：純黑白高對比鋼筆手繪線條，搭配傳統漫畫網點紙（Screentones）陰影、強烈速度線與集中線視覺張力，帶有經典單色漫畫連載原稿質感。'
  },
  {
    id: 'shonen_color',
    name: '彩色熱血少年漫',
    prompt: '【彩色熱血少年漫畫風格】：極具爆發力的鮮艷色彩對比，粗獷有力的黑色輪廓線，充滿動態張力的戰鬥特效光芒與光影渲染。'
  },
  {
    id: 'american_retro',
    name: '美式復古美漫風格',
    prompt: '【美式復古美漫風格】：美式黃金時代漫畫繪畫風格，採用經典班戴點（Ben-Day dots）印刷質感，厚重黑色墨線，濃烈復古美式漫畫彩圖風格。'
  },
  {
    id: 'cyberpunk_anime',
    name: '賽博朋克科幻動漫',
    prompt: '【賽博朋克科幻動漫風格】：高對比霓虹色彩（品紅、電光藍、螢光綠），充滿未來科技感的金屬質感、全息投影特效與深色夜景線描繪。'
  },
  {
    id: 'watercolor_handdrawn',
    name: '水彩手繪插畫漫畫風',
    prompt: '【水彩手繪插畫漫畫風】：溫柔輕盈的水彩暈染質感，透亮柔和的色彩層次，搭配優雅細緻的手繪墨線，充滿藝術插畫美感。'
  },
  {
    id: 'shojo_manga',
    name: '少女漫畫',
    prompt: '【少女漫畫風格】：纖細唯美的精緻線條，眼神光芒閃爍的大眼睛角色描繪，伴隨夢幻花瓣、閃光粒子背景與粉嫩柔和色彩氛圍。'
  },
  {
    id: 'bl_manga',
    name: 'BL漫畫',
    prompt: '【BL漫畫風格】：極具審美吸引力的修長角色輪廓，精緻立體的面部五官，柔和動人的光影暈染與帶有情感張力的視覺氛圍。'
  },
  {
    id: 'gl_manga',
    name: 'GL漫畫',
    prompt: '【GL漫畫風格】：清新細緻的日系二次元筆觸，溫柔優雅的角色色彩搭配，細膩動人的眼神互動與浪漫氛圍。'
  },
  {
    id: 'horror_manga',
    name: '恐怖漫畫',
    prompt: '【恐怖漫畫風格】：密集的黑白排線陰影，高對比度壓迫感光影，超現實驚悚元素，帶有陰森詭異美學的細節描繪。'
  }
];

export const MANGA_ARTIST_STYLES = [
  {
    id: 'miyazaki',
    name: '宮崎駿',
    prompt: '【宮崎駿吉卜力手繪動畫風格】：溫暖細緻的手繪質感，豐富自然的風景色彩，柔和的光影照射，懷舊與奇幻並存的浪漫唯美畫面氛圍。'
  },
  {
    id: 'dragon_ball',
    name: '七龍珠',
    prompt: '【鳥山明《七龍珠》經典漫畫風格】：極具力量感的硬朗線條，動態張力爆棚的動作姿態，經典刺刺頭造型與立體硬派肌肉線條描繪。'
  },
  {
    id: 'ikki_tousen',
    name: '一騎當千',
    prompt: '日本動漫鹽崎雄二漫畫畫風，賽璐珞著色。人物角色身材極度豐滿、胸部超大的日本女高中生，必須穿超短裙和低胸的服裝，露出結實的肌膚和腰部，背景充滿速度線，動態光影，高對比度，兼具華麗格鬥張力與性感魅力，大師之作。'
  },
  {
    id: 'one_piece',
    name: '海賊王',
    prompt: '【尾田榮一郎《海賊王 ONE PIECE》漫畫風格】：誇張而充滿活力的角色肢體比例，豐富熱鬧的細節背景，獨特且極具辨識度的角色面部表情。'
  },
  {
    id: 'demon_slayer',
    name: '鬼滅之刃',
    prompt: '【吾峠呼世晴《鬼滅之刃》漫畫風格】：濃郁重墨線條，日式傳統浮世繪水墨特效，層次鮮明的色彩對比與強烈情緒張力。'
  },
  {
    id: 'jujutsu_kaisen',
    name: '咒術迴戰',
    prompt: '【芥見下下《咒術迴戰》風格】：凌厲洗鍊的墨線，冷色調暗黑氛圍，張力十足的戰鬥姿態與詛咒氣氛。'
  },
  {
    id: 'frieren',
    name: '芙莉蓮',
    prompt: '【《葬送的芙莉蓮》奇幻風格】：細緻優雅的線條，淡雅清新的色彩塗裝，帶有詩意與漫長時光感的沉靜奇幻繪本美學。'
  },
  {
    id: 'nikke',
    name: '勝利女神NIKKE',
    prompt: '【《勝利女神：NIKKE》高品質二次元風格】：極高精細度的角色繪製，立體光影質感，華麗機械槍械與極具吸引力的角色身材曲線。'
  },
  {
    id: 'junji_ito',
    name: '伊藤潤二',
    prompt: '【伊藤潤二經典恐怖漫畫風格】：密集的黑白鋼筆排線，陰森詭異的陰影對比，超現實恐怖與不安感的面部描繪。'
  },
  {
    id: 'doraemon',
    name: '多拉A夢',
    prompt: '【藤子·F·不二雄《哆啦A夢》經典風格】：圓潤簡單的線條，鮮豔明亮的原色搭配，充滿童心與想像力的懷舊復古畫風。'
  }
];
