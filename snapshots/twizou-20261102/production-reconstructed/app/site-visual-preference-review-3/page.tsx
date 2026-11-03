"use client";

import { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "site-visual-preference-review-v3";
const DOWNLOAD_NAME = "site-visual-preference-review-batch3.json";
const PRIOR_POST_IDS = new Set<number>([2343, 1788, 1783, 2049, 2662, 2418, 1063, 2338, 1303, 2419, 2166, 1697, 2247, 2244, 1786, 1357, 1955, 1973, 1120, 1352, 2159, 2812, 2241, 2240, 2878, 2417, 1145, 1692, 2339, 2877, 2238, 2239, 2245, 2618, 1146, 2414, 1309, 1355, 2424, 1004, 2054, 2422, 2246, 1079, 2875, 1358, 1784, 2337, 1827, 1354, 1210, 1963, 1353, 2342, 2249, 1782, 2347, 1584, 2242, 2052, 1580, 2248, 1583, 1581, 1582, 1307, 1050, 1785, 1586, 1787, 2340, 2619, 1142, 2428, 2164, 2250, 1351, 1976, 1306, 1578, 2051, 1688, 2048, 2411, 1039, 2243, 1350, 2621, 2046, 2813, 2876, 1356, 1577, 2341, 1097, 1155, 2047, 1056, 1579, 1585]);
const PRIOR_AUTHORS = new Set<string>(["_lpxz11", "6edq4", "8ppx_a", "8vos23wvBguMjy3", "98OzeBGDhZARIyj", "ACoupleDiary", "Adalty70Adalty", "ai_ai_taro", "aigravurefaced", "akira_av_trend", "Aquarian72", "atya001", "ayakashi_info", "ch0575151690765", "ero__raku", "ero_kawaii_jp", "eromon3", "esuaru_m", "eto289624146732", "fanofmaki", "fee_fk3", "figure_bkk", "FullMoon0628", "glasses_love_ai", "grok_gravure", "hime_log_jp", "himitsunool", "hiroseyuuki", "IDOL_VR", "ikirumonobp95", "KAITO__TK", "kameratanosii", "KOKUGOkkkk", "mashiro_sekai_", "micax327", "modememorium", "momo2000310", "namiennty", "nemuinemui_aki", "newhalf_today", "oshaburi_hime", "pamyura_gakiko", "pnn_ay", "PurexXac2", "Rabbit_san777", "rgnagoya", "ribonmint_mme", "ryo_zzz_z", "sayu_04020325", "shirot_numa", "sirokuro0306", "swimsuit_idol", "timeleap_pocha", "TKpr_ran", "TohyaK2", "torikyatt", "umpiz00", "UNICORN_666R", "wasisuke_2nd", "wheatbatake", "XqNih1", "y0zaxra6", "yukakogoon"].map((author) => author.toLowerCase()));
const TIERS = ["S", "A", "B", "C", "D", "X"] as const;
const PREFERENCES = ["ideal", "not_ideal", "hold"] as const;
type Tier = (typeof TIERS)[number];
type Preference = (typeof PREFERENCES)[number];
type ReviewRecord = { preference: Preference; tier: Tier | null; reviewedAt: string };
type SamplePost = {
  id: number;
  xPostId: string;
  xUrl: string | null;
  previewImageUrl: string;
  authorUsername: string | null;
  authorName: string | null;
  createdAt: string | null;
  existingAdultTier: string | null;
};
type SavedState = { sample: SamplePost[]; reviews: Record<string, ReviewRecord>; position: number };
const HOLDOUT_SAMPLE: SamplePost[] = [
  {
    "id": 2103,
    "xPostId": "2092597976976044285",
    "xUrl": "https://x.com/_fanza_matome/status/2092597976976044285",
    "previewImageUrl": "https://pbs.twimg.com/ext_tw_video_thumb/2092597953412341761/pu/img/FglXLvZpTJXUC0sG.jpg",
    "authorUsername": "_fanza_matome",
    "authorName": "美咲｜FANZA・MGS紹介",
    "createdAt": "2026-08-26T13:00:10+00:00",
    "existingAdultTier": "B"
  },
  {
    "id": 2692,
    "xPostId": "2092170485459296316",
    "xUrl": "https://x.com/nmnhn_records/status/2092170485459296316",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2092170305834041344/img/tzGP6sK1y2q4kmfR.jpg",
    "authorUsername": "nmnhn_records",
    "authorName": "naminohana records",
    "createdAt": "2026-08-25T08:41:29+00:00",
    "existingAdultTier": "D"
  },
  {
    "id": 557,
    "xPostId": "2090771141489308037",
    "xUrl": "https://x.com/av_shinchaku19/status/2090771141489308037",
    "previewImageUrl": "https://pbs.twimg.com/ext_tw_video_thumb/2090771089903521792/pu/img/gxDfRDvVFQdSJSdf.jpg",
    "authorUsername": "av_shinchaku19",
    "authorName": "賢G（65）｜毎日デビュー作を1本観るジジイ",
    "createdAt": "2026-08-21T12:00:59+00:00",
    "existingAdultTier": "NONE"
  },
  {
    "id": 2129,
    "xPostId": "2092945621611409657",
    "xUrl": "https://x.com/gomibakoseithan/status/2092945621611409657",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2092944471147294720/img/WfDutwLgqxFsdPse.jpg",
    "authorUsername": "gomibakoseithan",
    "authorName": "グッチ@ミドリ蒸し🏴‍☠️",
    "createdAt": "2026-08-27T12:01:35+00:00",
    "existingAdultTier": "NONE"
  },
  {
    "id": 2600,
    "xPostId": "2090778002347164151",
    "xUrl": "https://x.com/ai9470909754556/status/2090778002347164151",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2090777835480952832/img/H9-KEC-djaK--1HB.jpg",
    "authorUsername": "ai9470909754556",
    "authorName": "みなと",
    "createdAt": "2026-08-21T12:28:15+00:00",
    "existingAdultTier": "B"
  },
  {
    "id": 536,
    "xPostId": "2090771336188870907",
    "xUrl": "https://x.com/gin_kuronyan/status/2090771336188870907",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2090771288260493312/img/naIlFhBzFfcFJZFw.jpg",
    "authorUsername": "gin_kuronyan",
    "authorName": "黒猫クロ銀（銀時）",
    "createdAt": "2026-08-21T12:01:45+00:00",
    "existingAdultTier": "NONE"
  },
  {
    "id": 1118,
    "xPostId": "2092229941949796536",
    "xUrl": "https://x.com/kobayashiteruya/status/2092229941949796536",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2092228972742647808/img/qNCBmQJfn7zEV5Ar.jpg",
    "authorUsername": "kobayashiteruya",
    "authorName": "小林輝哉",
    "createdAt": "2026-08-25T12:37:44+00:00",
    "existingAdultTier": "NONE"
  },
  {
    "id": 969,
    "xPostId": "2092224151444770913",
    "xUrl": "https://x.com/kazu1006213203/status/2092224151444770913",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2092223333878427648/img/nHSVKSHnry1kAMum.jpg",
    "authorUsername": "kazu1006213203",
    "authorName": "kazu世界の隅っこ",
    "createdAt": "2026-08-25T12:14:44+00:00",
    "existingAdultTier": "NONE"
  },
  {
    "id": 1542,
    "xPostId": "2091480575844753907",
    "xUrl": "https://x.com/AV_LOVER_21/status/2091480575844753907",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2091473332235612160/img/XgM_DyOZ9x4Fzga_.jpg",
    "authorUsername": "AV_LOVER_21",
    "authorName": "AV大好きマン",
    "createdAt": "2026-08-23T11:00:01+00:00",
    "existingAdultTier": "X"
  },
  {
    "id": 452,
    "xPostId": "2090768125042294909",
    "xUrl": "https://x.com/yudotanaka/status/2090768125042294909",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2090600310251339776/img/FB2dB4VjhAmyg3If.jpg",
    "authorUsername": "yudotanaka",
    "authorName": "田中勇道 | AI画像・動画生成",
    "createdAt": "2026-08-21T11:49:00+00:00",
    "existingAdultTier": "NONE"
  },
  {
    "id": 1147,
    "xPostId": "2092229407490629959",
    "xUrl": "https://x.com/3hiiz_/status/2092229407490629959",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2092229328931282944/img/HA_XABLuaYk4g567.jpg",
    "authorUsername": "3hiiz_",
    "authorName": "れい",
    "createdAt": "2026-08-25T12:35:37+00:00",
    "existingAdultTier": "NONE"
  },
  {
    "id": 1752,
    "xPostId": "2092497620371718286",
    "xUrl": "https://x.com/tsugitsugi_nugu/status/2092497620371718286",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2092497584120385536/img/KWZuX7NluhgZ5Vas.jpg",
    "authorUsername": "tsugitsugi_nugu",
    "authorName": "次々と脱いでく",
    "createdAt": "2026-08-26T06:21:24+00:00",
    "existingAdultTier": "NONE"
  },
  {
    "id": 674,
    "xPostId": "2090778986108367060",
    "xUrl": "https://x.com/YOSSY_MCNRY441/status/2090778986108367060",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2090778738334081024/img/fVmbyIwVWjzY2H5Q.jpg",
    "authorUsername": "YOSSY_MCNRY441",
    "authorName": "YOSSY",
    "createdAt": "2026-08-21T12:32:09+00:00",
    "existingAdultTier": "NONE"
  },
  {
    "id": 516,
    "xPostId": "2090771686987829346",
    "xUrl": "https://x.com/4hkODvuru2Kctz2/status/2090771686987829346",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2090743401838952448/img/DBFzz-AeGfOmhcQ2.jpg",
    "authorUsername": "4hkODvuru2Kctz2",
    "authorName": "マイティー@初エッセイ本発売中「リスタート　ゼロからのレベル上げ」Amazon・楽天で購入できます♪",
    "createdAt": "2026-08-21T12:03:09+00:00",
    "existingAdultTier": "NONE"
  },
  {
    "id": 908,
    "xPostId": "2092225441541271607",
    "xUrl": "https://x.com/Kigaru_ni_Golf/status/2092225441541271607",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2092225418338488320/img/42SXOjTHFGkMGiNH.jpg",
    "authorUsername": "Kigaru_ni_Golf",
    "authorName": "目土ゴルファー",
    "createdAt": "2026-08-25T12:19:51+00:00",
    "existingAdultTier": "NONE"
  },
  {
    "id": 2758,
    "xPostId": "2092604978594521552",
    "xUrl": "https://x.com/emuodana_pr/status/2092604978594521552",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2092529503130247168/img/Js0K6WmPsAS7hZzR.jpg",
    "authorUsername": "emuodana_pr",
    "authorName": "M男棚",
    "createdAt": "2026-08-26T13:28:00+00:00",
    "existingAdultTier": "B"
  },
  {
    "id": 594,
    "xPostId": "2090770904863379566",
    "xUrl": "https://x.com/MOtter25907/status/2090770904863379566",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2090318579497684992/img/_w-QliT2VZ-IUWJC.jpg",
    "authorUsername": "MOtter25907",
    "authorName": "FANZAHUB（Parody）",
    "createdAt": "2026-08-21T12:00:03+00:00",
    "existingAdultTier": "NONE"
  },
  {
    "id": 350,
    "xPostId": "2090766367893180679",
    "xUrl": "https://x.com/nono_ie_/status/2090766367893180679",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2059247978821660672/img/uWPfvSy-fmayXlZE.jpg",
    "authorUsername": "nono_ie_",
    "authorName": "ののいえ",
    "createdAt": "2026-08-21T11:42:01+00:00",
    "existingAdultTier": "NONE"
  },
  {
    "id": 2423,
    "xPostId": "2092928283273007579",
    "xUrl": "https://x.com/AI1106009627677/status/2092928283273007579",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2092928254680391680/img/syUeP52Sa0PzKpkf.jpg",
    "authorUsername": "AI1106009627677",
    "authorName": "Odango-san おだんごさん＠AIガール＆文字コラ師",
    "createdAt": "2026-08-27T10:52:42+00:00",
    "existingAdultTier": "NONE"
  },
  {
    "id": 822,
    "xPostId": "2091856806301835676",
    "xUrl": "https://x.com/mi5z8i/status/2091856806301835676",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2091856406295273472/img/i3v0f7QfvRsB7R1P.jpg",
    "authorUsername": "mi5z8i",
    "authorName": "きょーや",
    "createdAt": "2026-08-24T11:55:02+00:00",
    "existingAdultTier": "NONE"
  },
  {
    "id": 1632,
    "xPostId": "2092969551747293519",
    "xUrl": "https://x.com/ryukyuenmarche/status/2092969551747293519",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2092969364568043520/img/F8A3laEl9WgmS34d.jpg",
    "authorUsername": "ryukyuenmarche",
    "authorName": "琉球アンマルシュ",
    "createdAt": "2026-08-27T13:36:41+00:00",
    "existingAdultTier": "NONE"
  },
  {
    "id": 2002,
    "xPostId": "2091125447727923516",
    "xUrl": "https://x.com/adakingou/status/2091125447727923516",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2091125268341805056/img/5KAa-M8LbJyV_Zsi.jpg",
    "authorUsername": "adakingou",
    "authorName": "地味な子アンテナ",
    "createdAt": "2026-08-22T11:28:52+00:00",
    "existingAdultTier": "NONE"
  },
  {
    "id": 850,
    "xPostId": "2091856331074666621",
    "xUrl": "https://x.com/ryu_pi_110/status/2091856331074666621",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2091856044649803776/img/WctR9l_GzN-9ZdeV.jpg",
    "authorUsername": "ryu_pi_110",
    "authorName": "桑田龍征®︎【通販の虎】",
    "createdAt": "2026-08-24T11:53:08+00:00",
    "existingAdultTier": "NONE"
  },
  {
    "id": 2432,
    "xPostId": "2092905726532595803",
    "xUrl": "https://x.com/IshizakiTou90t/status/2092905726532595803",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2092905390149398528/img/x58ccTJpZY1p3zxU.jpg",
    "authorUsername": "IshizakiTou90t",
    "authorName": "明日香",
    "createdAt": "2026-08-27T09:23:04+00:00",
    "existingAdultTier": "NONE"
  },
  {
    "id": 1840,
    "xPostId": "2092027300175134971",
    "xUrl": "https://x.com/hazukasiiko/status/2092027300175134971",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2092027264578031616/img/AdehQ4tFakNvDxPE.jpg",
    "authorUsername": "hazukasiiko",
    "authorName": "しい子",
    "createdAt": "2026-08-24T23:12:31+00:00",
    "existingAdultTier": "B"
  },
  {
    "id": 389,
    "xPostId": "2090765530017964359",
    "xUrl": "https://x.com/Ra_shuny/status/2090765530017964359",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2090765490117660672/img/HD2o3S5IXuyf5Bk8.jpg",
    "authorUsername": "Ra_shuny",
    "authorName": "Ray",
    "createdAt": "2026-08-21T11:38:41+00:00",
    "existingAdultTier": "NONE"
  },
  {
    "id": 2675,
    "xPostId": "2092713489404133666",
    "xUrl": "https://x.com/Daijiro3939/status/2092713489404133666",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2092713290761904128/img/DTo0aHyhp6tj4Ygp.jpg",
    "authorUsername": "Daijiro3939",
    "authorName": "渡辺大次郎 /作曲家/ベースプレイヤー",
    "createdAt": "2026-08-26T20:39:11+00:00",
    "existingAdultTier": "D"
  },
  {
    "id": 998,
    "xPostId": "2092223591144464590",
    "xUrl": "https://x.com/taerae_sama/status/2092223591144464590",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2091910035395731456/img/wsi8OFxlNOiDSlYc.jpg",
    "authorUsername": "taerae_sama",
    "authorName": "世界で1番好きな声",
    "createdAt": "2026-08-25T12:12:30+00:00",
    "existingAdultTier": "NONE"
  },
  {
    "id": 1917,
    "xPostId": "2092961073779597734",
    "xUrl": "https://x.com/nico_yuki1025/status/2092961073779597734",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2092960985871265792/img/FumS7DuZ6x2_gWtX.jpg",
    "authorUsername": "nico_yuki1025",
    "authorName": "*･˚ゆき˚･*",
    "createdAt": "2026-08-27T13:02:59+00:00",
    "existingAdultTier": "NONE"
  },
  {
    "id": 1988,
    "xPostId": "2091605202524852639",
    "xUrl": "https://x.com/YMcBcHT9c918706/status/2091605202524852639",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2082967403634343936/img/Ne6Z1ZtpTKv1U6vl.jpg",
    "authorUsername": "YMcBcHT9c918706",
    "authorName": "猫寝子猫（ねこね　こねこ）",
    "createdAt": "2026-08-23T19:15:15+00:00",
    "existingAdultTier": "NONE"
  },
  {
    "id": 1454,
    "xPostId": "2092966820949131680",
    "xUrl": "https://x.com/ts15ts15/status/2092966820949131680",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2092966724404666368/img/_u3CkVxFkEMqz_Z0.jpg",
    "authorUsername": "ts15ts15",
    "authorName": "たっち",
    "createdAt": "2026-08-27T13:25:50+00:00",
    "existingAdultTier": "NONE"
  },
  {
    "id": 1078,
    "xPostId": "2092227290407301203",
    "xUrl": "https://x.com/sa_w9ra/status/2092227290407301203",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2092227252532781057/img/DSD4m_4TDZxTvXtj.jpg",
    "authorUsername": "sa_w9ra",
    "authorName": "男の有益情報",
    "createdAt": "2026-08-25T12:27:12+00:00",
    "existingAdultTier": "X"
  },
  {
    "id": 2404,
    "xPostId": "2090884618434302284",
    "xUrl": "https://x.com/AngelicaPrrgb/status/2090884618434302284",
    "previewImageUrl": "https://pbs.twimg.com/ext_tw_video_thumb/2090884368327999488/pu/img/VgQuO661Xbv_sMqJ.jpg",
    "authorUsername": "AngelicaPrrgb",
    "authorName": "MGSヒット番付",
    "createdAt": "2026-08-21T19:31:54+00:00",
    "existingAdultTier": "A"
  },
  {
    "id": 944,
    "xPostId": "2092224573265887526",
    "xUrl": "https://x.com/monamijanaiyo/status/2092224573265887526",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2092224494551392257/img/JFe-4ZWA10ZCoKbr.jpg",
    "authorUsername": "monamijanaiyo",
    "authorName": "もなみじゃないよ",
    "createdAt": "2026-08-25T12:16:24+00:00",
    "existingAdultTier": "NONE"
  },
  {
    "id": 666,
    "xPostId": "2090779223808237741",
    "xUrl": "https://x.com/umy__320/status/2090779223808237741",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2090779209216176128/img/vcZSJpvrPOiTYRJN.jpg",
    "authorUsername": "umy__320",
    "authorName": "いーにょいにょい",
    "createdAt": "2026-08-21T12:33:06+00:00",
    "existingAdultTier": "NONE"
  },
  {
    "id": 644,
    "xPostId": "2090779673982845063",
    "xUrl": "https://x.com/sr_Ilust/status/2090779673982845063",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2090779653653004288/img/l3KuRWFk3pvFMTV8.jpg",
    "authorUsername": "sr_Ilust",
    "authorName": "そらち",
    "createdAt": "2026-08-21T12:34:53+00:00",
    "existingAdultTier": "NONE"
  },
  {
    "id": 849,
    "xPostId": "2091856354256589010",
    "xUrl": "https://x.com/zinc_72/status/2091856354256589010",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2091856012471119873/img/QTpQcZY-g3nbQ_iL.jpg",
    "authorUsername": "zinc_72",
    "authorName": "ZinQ（ジンク）",
    "createdAt": "2026-08-24T11:53:14+00:00",
    "existingAdultTier": "NONE"
  },
  {
    "id": 583,
    "xPostId": "2090770909191717056",
    "xUrl": "https://x.com/Nakamachi00001/status/2090770909191717056",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2086736863285616640/img/zdloHRCbxpBs-B9G.jpg",
    "authorUsername": "Nakamachi00001",
    "authorName": "ナカマチ",
    "createdAt": "2026-08-21T12:00:04+00:00",
    "existingAdultTier": "NONE"
  },
  {
    "id": 804,
    "xPostId": "2091857116336390429",
    "xUrl": "https://x.com/layna_skate/status/2091857116336390429",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2091857060086636544/img/D1nc0D4Cdj1XN0rd.jpg",
    "authorUsername": "layna_skate",
    "authorName": "レイナワルツ⛸🏉🍃",
    "createdAt": "2026-08-24T11:56:16+00:00",
    "existingAdultTier": "NONE"
  },
  {
    "id": 1861,
    "xPostId": "2091797129979367817",
    "xUrl": "https://x.com/ScaraKabukimono/status/2091797129979367817",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2091796758443794432/img/8gYLrQxY50KAxe0Q.jpg",
    "authorUsername": "ScaraKabukimono",
    "authorName": "Kabukimono",
    "createdAt": "2026-08-24T07:57:54+00:00",
    "existingAdultTier": "A"
  },
  {
    "id": 1101,
    "xPostId": "2092226848763871433",
    "xUrl": "https://x.com/summer123ahead/status/2092226848763871433",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2092226683512520704/img/1HvE3UhumP0Q9GQO.jpg",
    "authorUsername": "summer123ahead",
    "authorName": "政治ごっこ夏野海太郎商店🔖 沖縄県知事はデニー推しで続投🗳️ ゴキブリ高市総理とはムエンダー‼️",
    "createdAt": "2026-08-25T12:25:27+00:00",
    "existingAdultTier": "NONE"
  },
  {
    "id": 492,
    "xPostId": "2090767344188752005",
    "xUrl": "https://x.com/hopethelightnin/status/2090767344188752005",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2090767115905298433/img/qW4RND7BHDCq5eQX.jpg",
    "authorUsername": "hopethelightnin",
    "authorName": "希望皇ホープ・ザ・ライトニング",
    "createdAt": "2026-08-21T11:45:54+00:00",
    "existingAdultTier": "NONE"
  },
  {
    "id": 2459,
    "xPostId": "2092784791321973152",
    "xUrl": "https://x.com/zombox777ai/status/2092784791321973152",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2092783705005703168/img/c-NJpuY7PF6AWdEx.jpg",
    "authorUsername": "zombox777ai",
    "authorName": "zombox777ai",
    "createdAt": "2026-08-27T01:22:30+00:00",
    "existingAdultTier": "C"
  },
  {
    "id": 1621,
    "xPostId": "2092969822451818539",
    "xUrl": "https://x.com/mukiryokustudio/status/2092969822451818539",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2092968483080568832/img/FR22XWcJguu9zg2Q.jpg",
    "authorUsername": "mukiryokustudio",
    "authorName": "Hal / 無気力スタジオ / AI + Creative +Music",
    "createdAt": "2026-08-27T13:37:45+00:00",
    "existingAdultTier": "NONE"
  },
  {
    "id": 527,
    "xPostId": "2090771487821324598",
    "xUrl": "https://x.com/RZagu06/status/2090771487821324598",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2090770840665350144/img/BL9YavD_ltWQAIIJ.jpg",
    "authorUsername": "RZagu06",
    "authorName": "Taniso(たにそ〜！)",
    "createdAt": "2026-08-21T12:02:22+00:00",
    "existingAdultTier": "NONE"
  },
  {
    "id": 2161,
    "xPostId": "2092850118764728546",
    "xUrl": "https://x.com/yukina_news777/status/2092850118764728546",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2092849329811943424/img/UE4EqUHEC6nhHq3Q.jpg",
    "authorUsername": "yukina_news777",
    "authorName": "ゆきなのニュース速報",
    "createdAt": "2026-08-27T05:42:06+00:00",
    "existingAdultTier": "NONE"
  },
  {
    "id": 1737,
    "xPostId": "2092567541998817479",
    "xUrl": "https://x.com/r18hgame/status/2092567541998817479",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2092566161968029697/img/5ETm9U4kBG5gDwYI.jpg",
    "authorUsername": "r18hgame",
    "authorName": "黃遊宅之道",
    "createdAt": "2026-08-26T10:59:14+00:00",
    "existingAdultTier": "B"
  },
  {
    "id": 3054,
    "xPostId": "2091822897706987881",
    "xUrl": "https://x.com/sm_sp49/status/2091822897706987881",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2090940311484907520/img/r6GZZE0JNRbiowq4.jpg",
    "authorUsername": "sm_sp49",
    "authorName": "SMスナイパー",
    "createdAt": "2026-08-24T09:40:17+00:00",
    "existingAdultTier": "X"
  },
  {
    "id": 2705,
    "xPostId": "2091548207243563220",
    "xUrl": "https://x.com/mimint_milk7/status/2091548207243563220",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2091547724231696384/img/GjrlMcQtOB1ulgID.jpg",
    "authorUsername": "mimint_milk7",
    "authorName": "ななな",
    "createdAt": "2026-08-23T15:28:46+00:00",
    "existingAdultTier": "D"
  },
  {
    "id": 2203,
    "xPostId": "2092631581487735099",
    "xUrl": "https://x.com/RirisuAmanoVid/status/2092631581487735099",
    "previewImageUrl": "https://pbs.twimg.com/amplify_video_thumb/2092631552702189568/img/P_uNdN43iFPUm2wQ.jpg",
    "authorUsername": "RirisuAmanoVid",
    "authorName": "Ririsu Amano Videos",
    "createdAt": "2026-08-26T15:13:42+00:00",
    "existingAdultTier": "NONE"
  }
];

function readSaved(): SavedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as SavedState;
    if (!value || !Array.isArray(value.sample) || !value.reviews || typeof value.position !== "number") return null;
    return value;
  } catch {
    return null;
  }
}

function dateLabel(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function SiteVisualPreferenceReviewPage() {
  const [sample, setSample] = useState<SamplePost[]>([]);
  const [reviews, setReviews] = useState<Record<string, ReviewRecord>>({});
  const [position, setPosition] = useState(0);
  const [tier, setTier] = useState<Tier | null>(null);
  const [loading, setLoading] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [imageFailed, setImageFailed] = useState<Record<number, boolean>>({});

  useEffect(() => {
    const saved = readSaved();
    if (saved?.sample.length) {
      setSample(saved.sample);
      setReviews(saved.reviews);
      setPosition(Math.max(0, Math.min(saved.position, saved.sample.length - 1)));
    } else {
      setSample(HOLDOUT_SAMPLE);
      setReviews({});
      setPosition(0);
    }
    setLoading(false);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated && sample.length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ sample, reviews, position }));
    }
  }, [hydrated, position, reviews, sample]);

  const item = sample[position];
  const reviewedCount = sample.filter((post) => reviews[String(post.id)]).length;
  const finished = sample.length === 50 && reviewedCount === sample.length;
  const counts = useMemo(() => {
    const preference = { ideal: 0, not_ideal: 0, hold: 0, unreviewed: 0 };
    const tiers: Record<string, number> = {};
    for (const post of sample) {
      const review = reviews[String(post.id)];
      if (!review) preference.unreviewed++;
      else preference[review.preference]++;
      if (review?.tier) tiers[review.tier] = (tiers[review.tier] ?? 0) + 1;
    }
    return { preference, tiers };
  }, [reviews, sample]);

  function commit(preference: Preference, selectedTier: Tier | null) {
    if (!item || (preference !== "hold" && !selectedTier)) return;
    setReviews((previous) => ({ ...previous, [String(item.id)]: { preference, tier: selectedTier, reviewedAt: new Date().toISOString() } }));
    setTier(null);
    if (position < sample.length - 1) setPosition((value) => value + 1);
  }

  function move(delta: number) {
    setPosition((value) => Math.max(0, Math.min(sample.length - 1, value + delta)));
    setTier(null);
  }

  function reset() {
    if (!window.confirm("保存した試験評価をすべてリセットしますか？")) return;
    localStorage.removeItem(STORAGE_KEY);
    setSample([]);
    setReviews({});
    setPosition(0);
    setTier(null);
    setSample(HOLDOUT_SAMPLE);
    setHydrated(true);
  }

  function download() {
    const output = sample.map((post) => {
      const review = reviews[String(post.id)];
      return { source: "site_holdout_batch3", postId: post.id, xPostId: post.xPostId, xUrl: post.xUrl, previewImageUrl: post.previewImageUrl, existingAdultTier: post.existingAdultTier, authorUsername: post.authorUsername, createdAt: post.createdAt, preference: review?.preference ?? null, tier: review?.tier ?? null, reviewedAt: review?.reviewedAt ?? null };
    });
    const blob = new Blob([JSON.stringify(output, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = DOWNLOAD_NAME;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT" || !item) return;
      const key = event.key.toUpperCase();
      if (TIERS.includes(key as Tier)) { setTier(key as Tier); return; }
      if (event.key === "1" && tier) commit("ideal", tier);
      if (event.key === "2" && tier) commit("not_ideal", tier);
      if (event.key === "3") commit("hold", null);
      if (event.key === "ArrowLeft") move(-1);
      if (event.key === "ArrowRight") move(1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [item, tier, position]);

  if (!hydrated || loading) return <main className="shell"><p>完全未使用テスト用サンプルを準備中...</p><Styles /></main>;
  if (sample.length < 50) return <main className="shell"><h1>サンプル不足</h1><p>評価に必要な固定50件を復元できませんでした。</p><button onClick={reset}>保存内容をリセット</button><Styles /></main>;

  if (finished) return <main className="shell"><Header /><div className="meta"><strong>50 / 50</strong><span>100%完了</span></div><div className="progress"><div style={{ width: "100%" }} /></div><Summary counts={counts} sample={sample} reviews={reviews} download={download} reset={reset} complete /><Styles /></main>;

  return <main className="shell">
    <Header />
    <div className="meta"><strong>{position + 1} / 50</strong><span>評価済み {reviewedCount}件（{Math.round((reviewedCount / 50) * 100)}%）</span></div>
    <div className="progress"><div style={{ width: `${Math.round((reviewedCount / 50) * 100)}%` }} /></div>
    <div className="toolbar"><button onClick={download}>JSONダウンロード</button><button onClick={reset}>評価をリセット</button></div>
    <div className="grid">
      <section className="visual">
        <div className="rank">完全未使用テスト用の自サイト投稿 ／ {position + 1}</div>
        {imageFailed[item.id] ? <div className="imageError">画像を読み込めません</div> : <img src={item.previewImageUrl} alt="投稿サムネイル" onError={() => setImageFailed((previous) => ({ ...previous, [item.id]: true }))} />}
        <div className="ids"><span>post ID: <b>{item.id}</b></span><span>投稿者: <b>{item.authorName ?? item.authorUsername ?? "不明"}</b></span><span>投稿日: <b>{dateLabel(item.createdAt)}</b></span></div>
        <div className="links">{item.xUrl ? <a href={item.xUrl} target="_blank" rel="noreferrer">X投稿を開く ↗</a> : <span>X投稿URLなし</span>}</div>
      </section>
      <aside className="panel">
        <h2>理想に近いですか？</h2><p className="hint">第3バッチ・完全未使用テスト用・DBには保存されません。tierを選んでから理想／非理想を確定してください。</p>
        <div className="tiers">{TIERS.map((value) => <button className={tier === value ? "selected" : ""} key={value} onClick={() => setTier(value)}>{value}</button>)}</div>
        <p>選択中のtier：<b>{tier ?? "未選択"}</b></p>
        <div className="decision"><button className="ideal" disabled={!tier} onClick={() => commit("ideal", tier)}>理想に近い <kbd>1</kbd></button><button className="notIdeal" disabled={!tier} onClick={() => commit("not_ideal", tier)}>理想ではない <kbd>2</kbd></button><button className="hold" onClick={() => commit("hold", null)}>保留 <kbd>3</kbd></button></div>
        <div className="nav"><button onClick={() => move(-1)} disabled={position === 0}>← 前へ</button><button onClick={() => move(1)} disabled={position === sample.length - 1}>次へ →</button></div>
        {reviews[String(item.id)] && <p className="saved">保存済み：{reviews[String(item.id)].preference} / tier {reviews[String(item.id)].tier ?? "-"}</p>}
      </aside>
    </div>
    <Summary counts={counts} sample={sample} reviews={reviews} compact />
    <Styles />
  </main>;
}

function Header() { return <header className="header"><div><p className="eyebrow">SITE VISUAL PREFERENCE REVIEW · HOLDOUT BATCH 3</p><h1>自サイト投稿の理想参照評価（第3バッチ）</h1></div><span className="notice">第3バッチ・完全未使用テスト用・DBには保存されません</span></header>; }

function Summary({ counts, sample, reviews, download, reset, compact = false, complete = false }: { counts: { preference: { ideal: number; not_ideal: number; hold: number; unreviewed: number }; tiers: Record<string, number> }; sample: SamplePost[]; reviews: Record<string, ReviewRecord>; download?: () => void; reset?: () => void; compact?: boolean; complete?: boolean }) {
  return <section className={compact ? "summary compact" : "summary"}><h2>{complete ? "完了サマリー" : "集計"}</h2><div className="summaryCards"><div><b>{counts.preference.ideal}</b><span>理想に近い</span></div><div><b>{counts.preference.not_ideal}</b><span>理想ではない</span></div><div><b>{counts.preference.hold}</b><span>保留</span></div><div><b>{counts.preference.unreviewed}</b><span>未評価</span></div></div><p>tier別件数：{TIERS.map((value) => `${value} ${counts.tiers[value] ?? 0}`).join(" ／ ")}</p>{complete && <div className="toolbar"><button onClick={download}>JSONダウンロード</button><button onClick={reset}>評価をリセット</button></div>}</section>;
}

function Styles() { return <style jsx global>{`
*{box-sizing:border-box}body{margin:0;background:#f4f5f7;color:#17191c}button{font:inherit;border:1px solid #cbd0d8;border-radius:8px;padding:9px 12px;background:#fff;cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}.shell{max-width:1200px;margin:0 auto;padding:26px 22px 56px}.header{display:flex;justify-content:space-between;gap:16px;align-items:center}.eyebrow{margin:0;color:#687082;font-size:11px;letter-spacing:.14em;font-weight:800}h1{margin:4px 0 12px}.notice{padding:9px 12px;border-radius:8px;background:#fff4d6;color:#795b16;font-size:12px;font-weight:700}.meta{display:flex;justify-content:space-between;margin-top:18px;font-size:13px}.progress{height:8px;margin:7px 0 14px;background:#dfe2e8;border-radius:99px;overflow:hidden}.progress div{height:100%;background:#2e465f;transition:width .2s}.toolbar{display:flex;flex-wrap:wrap;gap:9px;align-items:center;margin-bottom:18px}.toolbar button{font-size:12px}.grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(330px,.8fr);gap:20px;align-items:start}.visual,.panel,.summary{border:1px solid #d8dbe2;border-radius:14px;background:#fff}.visual{padding:16px}.rank{margin-bottom:10px;color:#687082;font-size:12px;font-weight:800}.visual img,.imageError{display:block;width:100%;aspect-ratio:16/10;object-fit:contain;background:#0c0e11;border-radius:9px}.imageError{display:grid;place-items:center;color:#c6cbd4}.ids{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:14px;color:#687082;font-size:12px}.ids b{color:#17191c}.links{margin-top:14px}.links a{color:#1d5caa;font-weight:700;font-size:13px}.panel{padding:20px}.hint{color:#626a76;font-size:13px;line-height:1.6}.tiers{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin:16px 0 10px}.tiers button{font-size:18px;font-weight:800}.tiers .selected{border-color:#2e465f;background:#e8eef5;box-shadow:inset 0 0 0 2px #2e465f}.decision{display:grid;gap:8px;margin-top:16px}.decision button{color:#fff;font-weight:800}.ideal{background:#23724b}.notIdeal{background:#a74646}.hold{background:#626a76}kbd{margin-left:5px;padding:2px 5px;border:1px solid #ffffff88;border-radius:4px}.nav{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px}.saved{padding:10px;background:#f2f3f6;border-radius:7px;font-size:12px}.summary{padding:18px;margin-top:20px}.summaryCards{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}.summaryCards div{padding:13px 8px;text-align:center;border:1px solid #e2e4e8;border-radius:8px}.summaryCards b,.summaryCards span{display:block}.summaryCards b{font-size:22px}.summaryCards span{color:#687082;font-size:11px;margin-top:4px}.error{padding:12px;border:1px solid #e2a1a1;border-radius:8px;background:#fff0f0;color:#8b2020}.compact .summaryCards{grid-template-columns:repeat(4,1fr)}
@media(max-width:760px){.shell{padding:16px 12px 42px}.header{align-items:flex-start;flex-direction:column}.grid{grid-template-columns:1fr}.summaryCards,.compact .summaryCards{grid-template-columns:repeat(2,1fr)}.tiers{grid-template-columns:repeat(3,1fr)}.toolbar{margin-top:8px}}
`}</style>; }
