import "dotenv/config";
import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

/* =========================================================
   API
========================================================= */

const API_KEY =
  process.env.API_FOOTBALL_KEY ||
  process.env.API_SPORTS_KEY ||
  process.env.API_KEY;

const API =
  "https://v3.football.api-sports.io";

if (!API_KEY) {
  console.error(
    "❌ .env içinde API_FOOTBALL_KEY / API_SPORTS_KEY / API_KEY bulunamadı."
  );
  process.exit(1);
}

const HEADERS = {
  "x-apisports-key": API_KEY
};

/* =========================================================
   AYARLAR
========================================================= */

const LIVE_REFRESH_MS = 15000;
const STATS_CACHE_MS = 25000;
const EVENTS_CACHE_MS = 20000;
const LINEUPS_CACHE_MS = 10 * 60 * 1000;
const SNAPSHOT_MS = 30000;
const TEN_MIN_MS = 10 * 60 * 1000;
const GOAL_WINDOW_MS = 3 * 60 * 1000;

/* =========================================================
   HAFIZA
========================================================= */

const statsCache = new Map();
const eventsCache = new Map();
const lineupsCache = new Map();
const snapshotMap = new Map();
const resultMap = new Map();
const trendMap = new Map();
const scoreMap = new Map();

let busy = false;
let lastUpdate = 0;
let lastError = null;
let apiRemaining = null;

/* =========================================================
   SAYI
========================================================= */

function num(v) {

  if (
    v === null ||
    v === undefined ||
    v === ""
  ) {
    return 0;
  }

  if (
    typeof v ===
    "number"
  ) {
    return Number.isFinite(v)
      ? v
      : 0;
  }

  const x =
    parseFloat(
      String(v)
        .replace("%", "")
        .replace(",", ".")
    );

  return Number.isFinite(x)
    ? x
    : 0;
}

function clamp(
  value,
  min = 0,
  max = 100
) {

  const x =
    Number(value);

  if (
    !Number.isFinite(x)
  ) {
    return min;
  }

  return Math.max(
    min,
    Math.min(
      max,
      x
    )
  );
}

/* =========================================================
   API İSTEĞİ
========================================================= */

async function apiGet(
  endpoint,
  params = {}
) {

  const url =
    new URL(
      API +
      endpoint
    );

  for (
    const [key, value]
    of Object.entries(
      params
    )
  ) {

    if (
      value !==
        undefined &&
      value !==
        null &&
      value !==
        ""
    ) {

      url.searchParams.set(
        key,
        String(value)
      );

    }

  }

  const response =
    await fetch(
      url,
      {
        method:
          "GET",

        headers:
          HEADERS
      }
    );

  const remain =
    response.headers.get(
      "x-ratelimit-requests-remaining"
    ) ||
    response.headers.get(
      "x-ratelimit-remaining"
    );

  if (
    remain !==
      null
  ) {
    apiRemaining =
      remain;
  }

  const json =
    await response
      .json()
      .catch(
        () => ({})
      );

  if (
    !response.ok
  ) {

    throw new Error(
      json?.message ||
      json?.errors?.requests ||
      `HTTP ${response.status}`
    );

  }

  if (
    json?.errors &&
    Object.keys(
      json.errors
    ).length
  ) {

    throw new Error(
      JSON.stringify(
        json.errors
      )
    );

  }

  return json;
}

/* =========================================================
   CANLI MAÇLAR
========================================================= */

async function getLiveFixtures() {

  const json =
    await apiGet(
      "/fixtures",
      {
        live:
          "all"
      }
    );

  return Array.isArray(
    json?.response
  )
    ? json.response
    : [];

}

/* =========================================================
   İSTATİSTİK
========================================================= */

async function getStatistics(
  fixtureId,
  force = false
) {

  const key =
    String(
      fixtureId
    );

  const now =
    Date.now();

  const old =
    statsCache.get(
      key
    );

  if (
    !force &&
    old &&
    old.data &&
    now -
      old.time <
      STATS_CACHE_MS
  ) {

    return old.data;

  }

  try {

    const json =
      await apiGet(
        "/fixtures/statistics",
        {
          fixture:
            fixtureId
        }
      );

    const data =
      Array.isArray(
        json?.response
      )
        ? json.response
        : [];

    statsCache.set(
      key,
      {
        time:
          now,

        data
      }
    );

    return data;

  } catch (
    error
  ) {

    console.log(
      `⚠️ İstatistik ${fixtureId}: ${error.message}`
    );

    return (
      old?.data ||
      []
    );

  }

}

/* =========================================================
   MAÇ OLAYLARI
========================================================= */

async function getFixtureEvents(
  fixtureId,
  force = false
) {

  const key =
    String(fixtureId);

  const now =
    Date.now();

  const old =
    eventsCache.get(
      key
    );

  if (
    !force &&
    old &&
    now -
      old.time <
      EVENTS_CACHE_MS
  ) {

    return old.data;
  }

  try {

    const json =
      await apiGet(
        "/fixtures/events",
        {
          fixture:
            fixtureId
        }
      );

    const data =
      Array.isArray(
        json?.response
      )
        ? json.response
        : [];

    eventsCache.set(
      key,
      {
        time:
          now,
        data
      }
    );

    return data;

  } catch (error) {

    console.log(
      `⚠️ Olaylar ${fixtureId}: ${error.message}`
    );

    return old?.data || [];
  }
}

/* =========================================================
   KADROLAR
========================================================= */

async function getFixtureLineups(
  fixtureId
) {

  const key =
    String(fixtureId);

  const now =
    Date.now();

  const old =
    lineupsCache.get(
      key
    );

  if (
    old &&
    now -
      old.time <
      LINEUPS_CACHE_MS
  ) {

    return old.data;
  }

  try {

    const json =
      await apiGet(
        "/fixtures/lineups",
        {
          fixture:
            fixtureId
        }
      );

    const data =
      Array.isArray(
        json?.response
      )
        ? json.response
        : [];

    lineupsCache.set(
      key,
      {
        time:
          now,
        data
      }
    );

    return data;

  } catch (error) {

    console.log(
      `⚠️ Kadro ${fixtureId}: ${error.message}`
    );

    return old?.data || [];
  }
}

/* =========================================================
   POZİSYON
========================================================= */

function normalizePosition(
  value
) {

  const p =
    String(
      value ||
      ""
    )
      .trim()
      .toUpperCase();

  if (
    p === "GK" ||
    p === "G" ||
    p.includes("GOAL")
  ) {
    return "KALECİ";
  }

  if (
    [
      "D",
      "DF",
      "CB",
      "LB",
      "RB",
      "LWB",
      "RWB"
    ].includes(p) ||
    p.startsWith("DEF")
  ) {
    return "DEFANS";
  }

  if (
    [
      "M",
      "MF",
      "DM",
      "CM",
      "AM",
      "LM",
      "RM"
    ].includes(p) ||
    p.startsWith("MID")
  ) {
    return "ORTA SAHA";
  }

  if (
    [
      "F",
      "FW",
      "ST",
      "CF",
      "LW",
      "RW"
    ].includes(p) ||
    p.startsWith("ATT")
  ) {
    return "FORVET";
  }

  return "BİLİNMİYOR";
}

/* =========================================================
   KART ANALİZİ

   Sarı/kırmızı kartlar gösterilir.
   Sinyale yalnızca savunma ve orta saha kartları
   etki eder.

   - Defans sarı: yüksek etki
   - Orta saha sarı: orta etki
   - Kırmızı / ikinci sarı: çok yüksek etki
   - Oyundan çıkan kartlı oyuncunun etkisi azaltılır
========================================================= */

async function getCardAnalysis(
  fixture,
  events
) {

  const emptyTeam = () => ({
    yellow: 0,
    red: 0,
    risk: 0,
    players: [],
    analysis:
      "Kartlı oyuncu yok."
  });

  const result = {
    available:
      Array.isArray(events),

    hasCards:
      false,

    home:
      emptyTeam(),

    away:
      emptyTeam()
  };

  const cardEvents =
    (events || []).filter(
      event =>
        String(
          event?.type ||
          ""
        ).toLowerCase() ===
        "card"
    );

  if (
    !cardEvents.length
  ) {

    result.home.analysis =
      "Kartlı oyuncu yok.";

    result.away.analysis =
      "Kartlı oyuncu yok.";

    return result;
  }

  result.hasCards =
    true;

  const lineups =
    await getFixtureLineups(
      fixture?.fixture?.id
    );

  const positionMap =
    new Map();

  for (
    const team
    of lineups || []
  ) {

    const allPlayers = [
      ...(team?.startXI || []),
      ...(team?.substitutes || [])
    ];

    for (
      const item
      of allPlayers
    ) {

      const player =
        item?.player ||
        item;

      if (
        player?.id ===
        undefined ||
        player?.id ===
        null
      ) {
        continue;
      }

      positionMap.set(
        String(
          player.id
        ),
        normalizePosition(
          item?.pos ||
          item?.position ||
          player?.pos ||
          player?.position
        )
      );
    }
  }

  const substitutionMap =
    new Map();

  for (
    const event
    of events || []
  ) {

    if (
      String(
        event?.type ||
        ""
      ).toLowerCase() !==
      "subst"
    ) {
      continue;
    }

    const outgoingId =
      event?.player?.id;

    if (
      outgoingId ===
      undefined ||
      outgoingId ===
      null
    ) {
      continue;
    }

    substitutionMap.set(
      String(
        outgoingId
      ),
      num(
        event?.time?.elapsed
      )
    );
  }

  for (
    const event
    of cardEvents
  ) {

    const teamId =
      Number(
        event?.team?.id
      );

    let team = null;

    if (
      teamId ===
      Number(
        fixture?.teams?.home?.id
      )
    ) {
      team =
        result.home;
    } else if (
      teamId ===
      Number(
        fixture?.teams?.away?.id
      )
    ) {
      team =
        result.away;
    }

    if (!team) {
      continue;
    }

    const detail =
      String(
        event?.detail ||
        ""
      );

    const isRed =
      /red|yellow-red|second yellow/i
        .test(detail);

    const isYellow =
      !isRed &&
      /yellow/i.test(
        detail
      );

    if (
      !isRed &&
      !isYellow
    ) {
      continue;
    }

    const player =
      event?.player ||
      {};

    const playerId =
      player?.id !==
      undefined &&
      player?.id !==
      null
        ? String(
            player.id
          )
        : "";

    const position =
      positionMap.get(
        playerId
      ) ||
      normalizePosition(
        player?.pos ||
        player?.position
      );

    const minute =
      num(
        event?.time?.elapsed
      );

    const extra =
      num(
        event?.time?.extra
      );

    const substitutedAt =
      substitutionMap.get(
        playerId
      );

    const stillOnPitch =
      substitutedAt ===
      undefined ||
      substitutedAt >
      minute;

    const item = {
      name:
        player?.name ||
        "Bilinmeyen oyuncu",

      position,

      minute:
        extra
          ? `${minute}+${extra}`
          : String(
              minute ||
              "?"
            ),

      type:
        isRed
          ? "RED"
          : "YELLOW",

      detail:
        isRed
          ? detail
          : detail,

      stillOnPitch
    };

    team.players.push(
      item
    );

    if (isRed) {
      team.red++;
    } else {
      team.yellow++;
    }

    if (
      position !==
        "DEFANS" &&
      position !==
        "ORTA SAHA"
    ) {
      continue;
    }

    let risk =
      isRed
        ? 12
        : position ===
          "DEFANS"
          ? 5
          : 3;

    if (
      minute > 0 &&
      minute <= 30
    ) {

      risk *=
        1.25;

    } else if (
      minute > 30 &&
      minute <= 60
    ) {

      risk *=
        1.10;
    }

    if (
      !stillOnPitch
    ) {

      risk *=
        0.35;
    }

    team.risk +=
      risk;
  }

  result.home.risk =
    Number(
      result.home.risk.toFixed(1)
    );

  result.away.risk =
    Number(
      result.away.risk.toFixed(1)
    );

  function makeAnalysis(
    team
  ) {

    const activeDefYellow =
      team.players.filter(
        player =>
          player.type ===
            "YELLOW" &&
          player.position ===
            "DEFANS" &&
          player.stillOnPitch
      );

    const activeMidYellow =
      team.players.filter(
        player =>
          player.type ===
            "YELLOW" &&
          player.position ===
            "ORTA SAHA" &&
          player.stillOnPitch
      );

    const activeRed =
      team.players.filter(
        player =>
          player.type ===
            "RED" &&
          (
            player.position ===
              "DEFANS" ||
            player.position ===
              "ORTA SAHA"
          ) &&
          player.stillOnPitch
      );

    if (
      activeRed.length
    ) {

      return (
        "🟥 " +
        activeRed
          .map(
            player =>
              player.name
          )
          .join(", ") +
        " kırmızı kartlı. Rakip hücumuna çok ciddi alan avantajı oluştu."
      );
    }

    if (
      activeDefYellow.length >=
      2
    ) {

      return (
        "⚠️ " +
        activeDefYellow.length +
        " defans oyuncusu sarı kartlı. İkili mücadelelerde daha temkinli oynama riski yüksek."
      );
    }

    if (
      activeDefYellow.length ===
      1
    ) {

      return (
        "⚠️ " +
        activeDefYellow[0].name +
        " sarı kartlı defans oyuncusu. Rakip hücumunda daha temkinli oynama riski sinyale dahil edildi."
      );
    }

    if (
      activeMidYellow.length
    ) {

      return (
        "⚠️ " +
        activeMidYellow.length +
        " orta saha oyuncusu sarı kartlı. Baskı ve ikili mücadele etkisi hesaba katıldı."
      );
    }

    if (
      team.players.length
    ) {

      return (
        "ℹ️ Kart var ancak kartlı oyuncuların mevcut pozisyonu savunma/orta saha kaynaklı güçlü sinyal üretmiyor."
      );
    }

    return "Kartlı oyuncu yok.";
  }

  result.home.analysis =
    makeAnalysis(
      result.home
    );

  result.away.analysis =
    makeAnalysis(
      result.away
    );

  return result;
}

/* =========================================================
   STAT OKU
========================================================= */

function readStat(
  list,
  names
) {

  if (
    !Array.isArray(
      list
    )
  ) {
    return 0;
  }

  const wanted =
    names.map(
      x =>
        String(
          x
        ).toLowerCase()
    );

  const item =
    list.find(
      x =>
        wanted.includes(
          String(
            x?.type ||
            ""
          ).toLowerCase()
        )
    );

  return num(
    item?.value
  );
}

/* =========================================================
   STAT PARSE
========================================================= */

function parseStatistics(
  raw,
  fixture
) {

  const blocks =
    Array.isArray(raw)
      ? raw
      : [];

  const homeId =
    Number(
      fixture
        ?.teams
        ?.home
        ?.id
    );

  const awayId =
    Number(
      fixture
        ?.teams
        ?.away
        ?.id
    );

  const homeBlock =
    blocks.find(
      x =>
        Number(
          x?.team?.id
        ) ===
        homeId
    ) ||
    blocks[0] ||
    {};

  const awayBlock =
    blocks.find(
      x =>
        Number(
          x?.team?.id
        ) ===
        awayId
    ) ||
    blocks[1] ||
    {};

  const H =
    homeBlock.statistics ||
    [];

  const A =
    awayBlock.statistics ||
    [];

  function teamStats(
    list
  ) {

    return {

      shots:
        readStat(
          list,
          [
            "Total Shots",
            "Goal Attempts"
          ]
        ),

      on:
        readStat(
          list,
          [
            "Shots on Goal",
            "Shots on Target"
          ]
        ),

      corners:
        readStat(
          list,
          [
            "Corner Kicks",
            "Corners"
          ]
        ),

      possession:
        readStat(
          list,
          [
            "Ball Possession"
          ]
        ),

      xg:
        readStat(
          list,
          [
            "expected_goals",
            "Expected Goals",
            "xG"
          ]
        ),

      attacks:
        readStat(
          list,
          [
            "Attacks"
          ]
        ),

      dangerous:
        readStat(
          list,
          [
            "Dangerous Attacks"
          ]
        )

    };

  }

  const types =
    blocks.flatMap(
      b =>
        (
          b?.statistics ||
          []
        ).map(
          x =>
            String(
              x?.type ||
              ""
            ).toLowerCase()
        )
    );

  return {

    available:
      blocks.length >=
        2 &&
      (
        H.length ||
        A.length
      ),

    hasDangerous:
      types.includes(
        "dangerous attacks"
      ),

    hasXg:
      types.includes(
        "xg"
      ) ||
      types.includes(
        "expected goals"
      ) ||
      types.includes(
        "expected_goals"
      ),

    home:
      teamStats(H),

    away:
      teamStats(A)

  };
}

/* =========================================================
   SNAPSHOT
========================================================= */

function saveSnapshot(
  id,
  stats,
  fixture
) {

  const key =
    String(id);

  const now =
    Date.now();

  let list =
    snapshotMap.get(
      key
    ) || [];

  const last =
    list[
      list.length -
        1
    ];

  if (
    !last ||
    now -
      last.time >=
      SNAPSHOT_MS
  ) {

    list.push({

      time:
        now,

      minute:
        num(
          fixture
            ?.fixture
            ?.status
            ?.elapsed
        ),

      home:
        {
          ...stats.home
        },

      away:
        {
          ...stats.away
        }

    });

  }

  const cutoff =
    now -
    TEN_MIN_MS;

  list =
    list.filter(
      item =>
        item.time >=
        cutoff
    );

  snapshotMap.set(
    key,
    list
  );

  return list;
}

/* =========================================================
   SON 10 DK BASKI
========================================================= */

function getPressure(
  stats,
  list
) {

  if (
    !Array.isArray(
      list
    ) ||
    list.length <
      2
  ) {

    return {

      ready:
        false,

      window:
        0,

      home: {

        shots:
          0,

        on:
          0,

        corners:
          0,

        xg:
          0,

        attacks:
          0,

        dangerous:
          0

      },

      away: {

        shots:
          0,

        on:
          0,

        corners:
          0,

        xg:
          0,

        attacks:
          0,

        dangerous:
          0

      },

      shortHome: {

        shots:
          0,

        on:
          0,

        dangerous:
          0,

        xg:
          0

      },

      shortAway: {

        shots:
          0,

        on:
          0,

        dangerous:
          0,

        xg:
          0

      },

      homePct:
        50,

      awayPct:
        50,

      dominant:
        "equal"

    };
  }

  const now =
    Date.now();

  const current =
    list[
      list.length -
        1
    ];

  const tenBase =
    list[0];

  const shortIndex =
    Math.max(
      0,
      list.length -
        3
    );

  const shortBase =
    list[
      shortIndex
    ];

  function delta(
    a,
    b
  ) {

    return Math.max(
      0,
      num(a) -
      num(b)
    );

  }

  function make(
    currentTeam,
    baseTeam
  ) {

    return {

      shots:
        delta(
          currentTeam.shots,
          baseTeam.shots
        ),

      on:
        delta(
          currentTeam.on,
          baseTeam.on
        ),

      corners:
        delta(
          currentTeam.corners,
          baseTeam.corners
        ),

      xg:
        delta(
          currentTeam.xg,
          baseTeam.xg
        ),

      attacks:
        delta(
          currentTeam.attacks,
          baseTeam.attacks
        ),

      dangerous:
        delta(
          currentTeam.dangerous,
          baseTeam.dangerous
        )

    };

  }

  const home =
    make(
      stats.home,
      tenBase.home
    );

  const away =
    make(
      stats.away,
      tenBase.away
    );

  const shortHome =
    make(
      stats.home,
      shortBase.home
    );

  const shortAway =
    make(
      stats.away,
      shortBase.away
    );

  const homeScore =

    home.shots *
      1.5 +

    home.on *
      8.5 +

    home.corners *
      1.0 +

    home.xg *
      20 +

    home.attacks *
      0.03 +

    home.dangerous *
      0.35;

  const awayScore =

    away.shots *
      1.5 +

    away.on *
      8.5 +

    away.corners *
      1.0 +

    away.xg *
      20 +

    away.attacks *
      0.03 +

    away.dangerous *
      0.35;

  const total =
    homeScore +
    awayScore;

  const homePct =
    total > 0
      ? Math.round(
          homeScore /
          total *
          100
        )
      : 50;

  return {

    ready:
      true,

    window:
      Math.max(
        0,
        Math.round(
          (
            now -
            tenBase.time
          ) /
          60000
        )
      ),

    elapsedSinceLast:
      Math.max(
        0,
        Math.round(
          (
            now -
            current.time
          ) /
          1000
        )
      ),

    home,

    away,

    shortHome,

    shortAway,

    homePct,

    awayPct:
      100 -
      homePct,

    dominant:
      homePct >=
        60
        ? "home"
        : homePct <=
            40
          ? "away"
          : "equal"

  };
}

/* =========================================================
   TAKIM BASKISI
========================================================= */

function getTeamPressure(
  s,
  p
) {

  const ph =
    p.ready
      ? p.home
      : {};

  const pa =
    p.ready
      ? p.away
      : {};

  const homeScore =

    s.home.shots *
      1.1 +

    s.home.on *
      6.5 +

    s.home.corners *
      0.7 +

    num(ph.shots) *
      2.2 +

    num(ph.on) *
      10 +

    num(ph.corners) *
      1.2 +

    num(ph.xg) *
      18 +

    num(ph.dangerous) *
      0.40;

  const awayScore =

    s.away.shots *
      1.1 +

    s.away.on *
      6.5 +

    s.away.corners *
      0.7 +

    num(pa.shots) *
      2.2 +

    num(pa.on) *
      10 +

    num(pa.corners) *
      1.2 +

    num(pa.xg) *
      18 +

    num(pa.dangerous) *
      0.40;

  const total =
    homeScore +
    awayScore;

  const homePct =
    total
      ? Math.round(
          homeScore /
          total *
          100
        )
      : 50;

  const awayPct =
    100 -
    homePct;

  const onDiff =
    s.home.on -
    s.away.on;

  const shotDiff =
    s.home.shots -
    s.away.shots;

  const recentHomeOn =
    num(ph.on);

  const recentAwayOn =
    num(pa.on);

  const recentHomeShots =
    num(ph.shots);

  const recentAwayShots =
    num(pa.shots);

  const recentDangerDiff =
    num(ph.dangerous) -
    num(pa.dangerous);

  const homeStrong =

    (
      s.home.on >=
        2 &&
      s.home.shots >=
        5 &&
      onDiff >=
        1
    ) ||

    (
      recentHomeOn >=
        2 &&
      recentHomeShots >=
        4 &&
      homePct >=
        58
    ) ||

    (
      recentDangerDiff >=
        3 &&
      homePct >=
        58
    ) ||

    (
      homePct >=
        70 &&
      s.home.on >=
        2
    );

  const awayStrong =

    (
      s.away.on >=
        2 &&
      s.away.shots >=
        5 &&
      onDiff <=
        -1
    ) ||

    (
      recentAwayOn >=
        2 &&
      recentAwayShots >=
        4 &&
      awayPct >=
        58
    ) ||

    (
      recentDangerDiff <=
        -3 &&
      awayPct >=
        58
    ) ||

    (
      awayPct >=
        70 &&
      s.away.on >=
        2
    );

  return {

    homePct,

    awayPct,

    dominant:
      homePct >=
        60
        ? "home"
        : awayPct >=
            60
          ? "away"
          : "equal",

    homeStrong,

    awayStrong,

    recentHomeShots,

    recentAwayShots,

    recentHomeOn,

    recentAwayOn

  };
}

/* =========================================================
   SKOR TAKİBİ
========================================================= */

function trackScore(
  id,
  fixture
) {

  const key =
    String(id);

  const now =
    Date.now();

  const home =
    num(
      fixture
        ?.goals
        ?.home
    );

  const away =
    num(
      fixture
        ?.goals
        ?.away
    );

  let old =
    scoreMap.get(
      key
    );

  if (
    !old
  ) {

    old = {

      home,

      away,

      lastGoalAt:
        0,

      lastGoalSide:
        "",

      initialScore:
        `${home}-${away}`

    };

    scoreMap.set(
      key,
      old
    );

    return {

      changed:
        false,

      lastGoalAt:
        0,

      lastGoalSide:
        "",

      scoreAgeMs:
        Infinity

    };
  }

  let changed =
    false;

  if (
    home >
    old.home
  ) {

    old.lastGoalAt =
      now;

    old.lastGoalSide =
      "home";

    changed =
      true;

  } else if (
    away >
    old.away
  ) {

    old.lastGoalAt =
      now;

    old.lastGoalSide =
      "away";

    changed =
      true;

  }

  old.home =
    home;

  old.away =
    away;

  return {

    changed,

    lastGoalAt:
      old.lastGoalAt ||
      0,

    lastGoalSide:
      old.lastGoalSide ||
      "",

    scoreAgeMs:
      old.lastGoalAt
        ? now -
          old.lastGoalAt
        : Infinity

  };
}

/* =========================================================
   TREND
========================================================= */

function getTrend(
  id,
  value
) {

  const key =
    String(id);

  let list =
    trendMap.get(
      key
    ) || [];

  const previous =
    list.length
      ? list[
          list.length -
            1
        ].value
      : null;

  list.push({

    time:
      Date.now(),

    value

  });

  if (
    list.length >
    12
  ) {

    list.shift();

  }

  trendMap.set(
    key,
    list
  );

  if (
    previous ===
    null
  ) {

    return {

      trend:
        "NEW",

      change:
        0

    };

  }

  const change =
    Math.round(
      value -
      previous
    );

  return {

    trend:
      change >=
        4
        ? "RISING"
        : change <=
            -4
          ? "FALLING"
          : "STABLE",

    change

  };
}

/* =========================================================
   ANA SİNYAL
========================================================= */

function calculateSignal(
  fixture,
  s,
  p,
  tm,
  scoreInfo,
  cards
) {

  const minute =
    num(
      fixture
        ?.fixture
        ?.status
        ?.elapsed
    );

  const totalShots =
    s.home.shots +
    s.away.shots;

  const totalOn =
    s.home.on +
    s.away.on;

  const totalCorners =
    s.home.corners +
    s.away.corners;

  const totalXg =
    s.home.xg +
    s.away.xg;

  const totalDanger =
    s.home.dangerous +
    s.away.dangerous;

  const ready =
    !!p.ready;

  const recentShots =
    ready
      ? p.home.shots +
        p.away.shots
      : 0;

  const recentOn =
    ready
      ? p.home.on +
        p.away.on
      : 0;

  const recentCorners =
    ready
      ? p.home.corners +
        p.away.corners
      : 0;

  const recentXg =
    ready
      ? p.home.xg +
        p.away.xg
      : 0;

  const recentDanger =
    ready
      ? p.home.dangerous +
        p.away.dangerous
      : 0;

  const shortShots =
    ready
      ? p.shortHome.shots +
        p.shortAway.shots
      : 0;

  const shortOn =
    ready
      ? p.shortHome.on +
        p.shortAway.on
      : 0;

  const shortDanger =
    ready
      ? p.shortHome.dangerous +
        p.shortAway.dangerous
      : 0;

  const shortXg =
    ready
      ? p.shortHome.xg +
        p.shortAway.xg
      : 0;

  const strongestPressure =
    Math.max(
      tm.homePct,
      tm.awayPct
    );

  const afterGoal =
    Number.isFinite(
      scoreInfo?.scoreAgeMs
    ) &&
    scoreInfo.scoreAgeMs <
      GOAL_WINDOW_MS;

  const homeCardRisk =
    num(
      cards?.home?.risk
    );

  const awayCardRisk =
    num(
      cards?.away?.risk
    );

  let score =
    0;

  const reasons =
    [];

  function add(
    points,
    label
  ) {

    if (
      points >
      0
    ) {

      score +=
        points;

      reasons.push({

        points,

        label

      });

    }

  }

  /* -------------------------------------------------------
     TOPLAM VERİ
  ------------------------------------------------------- */

  add(
    Math.min(
      12,
      totalShots *
        0.8
    ),
    "Toplam şut"
  );

  add(
    Math.min(
      25,
      totalOn *
        5
    ),
    "İsabetli şut"
  );

  add(
    Math.min(
      5,
      totalCorners *
        0.5
    ),
    "Korner"
  );

  add(
    Math.min(
      12,
      totalXg *
        10
    ),
    "xG"
  );

  if (
    s.hasDangerous
  ) {

    add(
      Math.min(
        12,
        totalDanger *
          0.28
      ),
      "Tehlikeli atak"
    );

  }

  /* -------------------------------------------------------
     İSABETLİ ŞUT ÖZEL SİNYALİ

     3 isabetli şut, özellikle tek takımda oluşuyorsa,
     toplam tehlikeli atak verisi 0 olsa bile baskı üretir.
  ------------------------------------------------------- */

  const homeOnTargetStrong =
    s.home.on >= 3 &&
    (
      s.home.shots >= 4 ||
      tm.homeStrong ||
      tm.homePct >= 55
    );

  const awayOnTargetStrong =
    s.away.on >= 3 &&
    (
      s.away.shots >= 4 ||
      tm.awayStrong ||
      tm.awayPct >= 55
    );

  if (
    homeOnTargetStrong
  ) {

    add(
      12,
      "Ev sahibi 3+ isabetli şut"
    );

  }

  if (
    awayOnTargetStrong
  ) {

    add(
      12,
      "Deplasman 3+ isabetli şut"
    );

  }

  if (
    s.home.on >= 4
  ) {

    add(
      7,
      "Ev sahibi 4+ isabetli şut"
    );

  }

  if (
    s.away.on >= 4
  ) {

    add(
      7,
      "Deplasman 4+ isabetli şut"
    );

  }

  /* -------------------------------------------------------
     KART ETKİSİ

     Ev savunması kartlıysa deplasman hücum riski,
     deplasman savunması kartlıysa ev hücum riski artar.
  ------------------------------------------------------- */

  if (
    homeCardRisk > 0
  ) {

    add(
      Math.min(
        12,
        Math.round(
          homeCardRisk *
          0.70
        )
      ),
      "Ev savunmasında kart baskısı — rakip hücum riski"
    );

  }

  if (
    awayCardRisk > 0
  ) {

    add(
      Math.min(
        12,
        Math.round(
          awayCardRisk *
          0.70
        )
      ),
      "Deplasman savunmasında kart baskısı — ev hücum riski"
    );

  }

  if (
    cards?.home?.red >
    0 &&
    homeCardRisk >
    0
  ) {

    add(
      12,
      "Ev defans/orta saha kırmızı kart"
    );

  }

  if (
    cards?.away?.red >
    0 &&
    awayCardRisk >
    0
  ) {

    add(
      12,
      "Deplasman defans/orta saha kırmızı kart"
    );

  }

  /* -------------------------------------------------------
     SON 10 DK
  ------------------------------------------------------- */

  if (
    ready
  ) {

    add(
      Math.min(
        12,
        recentShots *
          2
      ),
      "Son 10 dk şut"
    );

    add(
      Math.min(
        22,
        recentOn *
          8
      ),
      "Son 10 dk isabet"
    );

    add(
      Math.min(
        6,
        recentCorners *
          1.2
      ),
      "Son 10 dk korner"
    );

    add(
      Math.min(
        14,
        recentXg *
          28
      ),
      "Son 10 dk xG"
    );

    add(
      Math.min(
        20,
        recentDanger *
          0.70
      ),
      "Son 10 dk tehlikeli"
    );

  }

  /* -------------------------------------------------------
     SON KISA BÖLÜM
  ------------------------------------------------------- */

  if (
    ready
  ) {

    add(
      Math.min(
        6,
        shortShots *
          1.6
      ),
      "Son bölüm tempo"
    );

    add(
      Math.min(
        12,
        shortOn *
          6
      ),
      "Son bölüm isabet"
    );

    add(
      Math.min(
        9,
        shortDanger *
          0.9
      ),
      "Son bölüm tehlikeli"
    );

    add(
      Math.min(
        8,
        shortXg *
          22
      ),
      "Son bölüm xG"
    );

  }

  /* -------------------------------------------------------
     TAKIM BASKISI
  ------------------------------------------------------- */

  if (
    tm.homeStrong
  ) {

    add(
      8,
      "EV SAHİBİ BASIYOR"
    );

  }

  if (
    tm.awayStrong
  ) {

    add(
      8,
      "DEPLASMAN BASIYOR"
    );

  }

  if (
    tm.homePct >=
    75
  ) {

    add(
      5,
      "Ev baskısı 75+"
    );

  }

  if (
    tm.awayPct >=
    75
  ) {

    add(
      5,
      "Deplasman baskısı 75+"
    );

  }

  if (
    tm.homePct >=
    85
  ) {

    add(
      7,
      "Ev baskısı 85+"
    );

  }

  if (
    tm.awayPct >=
    85
  ) {

    add(
      7,
      "Deplasman baskısı 85+"
    );

  }

  /* -------------------------------------------------------
     KOMBİNASYON
  ------------------------------------------------------- */

  if (
    ready &&
    recentShots >=
      4 &&
    recentOn >=
      2
  ) {

    add(
      10,
      "Şut + 2 isabet"
    );

  }

  if (
    ready &&
    recentOn >=
      2 &&
    recentDanger >=
      6
  ) {

    add(
      9,
      "İsabet + tehlikeli"
    );

  }

  if (
    ready &&
    recentOn >=
      2 &&
    recentXg >=
      0.20
  ) {

    add(
      8,
      "İsabet + xG"
    );

  }

  if (
    ready &&
    shortOn >=
      1 &&
    shortDanger >=
      3
  ) {

    add(
      7,
      "Kısa bölüm baskısı"
    );

  }

  /* -------------------------------------------------------
     0-15 DK
  ------------------------------------------------------- */

  if (
    minute <=
      15 &&
    s.available
  ) {

    if (
      totalShots >=
      3
    ) {

      add(
        4,
        "İlk 15 dk şut"
      );

    }

    if (
      totalShots >=
      5
    ) {

      add(
        5,
        "İlk 15 dk şut 5+"
      );

    }

    if (
      totalOn >=
      1
    ) {

      add(
        7,
        "İlk 15 dk isabet"
      );

    }

    if (
      totalOn >=
      2
    ) {

      add(
        11,
        "İlk 15 dk 2 isabet"
      );

    }

    if (
      totalOn >=
        2 &&
      (
        tm.homeStrong ||
        tm.awayStrong
      )
    ) {

      add(
        8,
        "Erken güçlü baskı"
      );

    }

  }

  /* -------------------------------------------------------
     VERİ YOK
  ------------------------------------------------------- */

  if (
    !s.available
  ) {

    score =
      0;

  }

  if (
    s.available &&
    totalShots ===
      0 &&
    totalOn ===
      0 &&
    totalCorners ===
      0
  ) {

    score =
      0;

  }

  /* -------------------------------------------------------
     BOŞ MAÇ FRENİ
  ------------------------------------------------------- */

  if (
    totalShots >=
      15 &&
    totalOn ===
      0 &&
    recentOn ===
      0
  ) {

    score =
      Math.min(
        score,
        45
      );

  }

  if (
    s.hasDangerous &&
    totalDanger <
      10 &&
    recentDanger <
      3 &&
    totalOn <
      2 &&
    totalShots <
      10
  ) {

    score =
      Math.min(
        score,
        52
      );

  }

  if (
    !ready &&
    minute >
      15
  ) {

    score =
      Math.min(
        score,
        64
      );

  }

  /* -------------------------------------------------------
     %0-100
     ARTIK SABİT 82 YOK
  ------------------------------------------------------- */

  score =
    clamp(
      Math.round(
        score
      )
    );

  let side =
    "";

  if (
    tm.homeStrong
  ) {

    side =
      "EV SAHİBİ";

  } else if (
    tm.awayStrong
  ) {

    side =
      "DEPLASMAN";

  } else if (
    tm.dominant ===
    "home"
  ) {

    side =
      "EV SAHİBİ";

  } else if (
    tm.dominant ===
    "away"
  ) {

    side =
      "DEPLASMAN";

  }

  /* -------------------------------------------------------
     ÖN-GOL
  ------------------------------------------------------- */

  const homePreGoal =
    !afterGoal &&
    (
      (
        tm.homeStrong &&
        s.home.shots >=
          5 &&
        s.home.on >=
          2
      ) ||
      (
        ready &&
        tm.homePct >=
          65 &&
        tm.recentHomeOn >=
          2 &&
        tm.recentHomeShots >=
          4
      )
    );

  const awayPreGoal =
    !afterGoal &&
    (
      (
        tm.awayStrong &&
        s.away.shots >=
          5 &&
        s.away.on >=
          2
      ) ||
      (
        ready &&
        tm.awayPct >=
          65 &&
        tm.recentAwayOn >=
          2 &&
        tm.recentAwayShots >=
          4
      )
    );

  /* -------------------------------------------------------
     GOL SİNYALİ
  ------------------------------------------------------- */

  const threeOnTargetGoal =
    !afterGoal &&
    (
      (
        s.home.on >=
          3 &&
        (
          tm.homeStrong ||
          tm.homePct >=
            60
        )
      ) ||
      (
        s.away.on >=
          3 &&
        (
          tm.awayStrong ||
          tm.awayPct >=
            60
        )
      )
    );

  const veryStrong =
    !afterGoal &&
    (
      (
        score >=
          78 &&
        (
          (
            ready &&
            recentShots >=
              4 &&
            recentOn >=
              2 &&
            (
              recentDanger >=
                5 ||
              recentXg >=
                0.20 ||
              tm.homeStrong ||
              tm.awayStrong
            )
          ) ||
          (
            minute <=
              15 &&
            totalShots >=
              5 &&
            totalOn >=
              2 &&
            (
              tm.homeStrong ||
              tm.awayStrong
            )
          ) ||
          (
            homePreGoal &&
            s.home.on >=
              3
          ) ||
          (
            awayPreGoal &&
            s.away.on >=
              3
          )
        )
      ) ||
      (
        score >=
          60 &&
        threeOnTargetGoal
      )
    );

  const strong =
    (
      tm.homeStrong ||
      tm.awayStrong
    ) &&
    totalShots >=
      5 &&
    totalOn >=
      2;

  let alert =
    "NORMAL";

  let alertLevel =
    0;

  if (
    veryStrong
  ) {

    alert =
      "GOL SİNYALİ";

    alertLevel =
      3;

  } else if (
    score >=
      60 &&
    (
      strong ||
      homePreGoal ||
      awayPreGoal ||
      (
        ready &&
        recentShots >=
          3 &&
        recentOn >=
          1
      )
    )
  ) {

    alert =
      side ===
        "EV SAHİBİ"
        ? "EV BASIYOR"
        : side ===
            "DEPLASMAN"
          ? "DEPLASMAN BASIYOR"
          : "GÜÇLÜ BASKI";

    alertLevel =
      2;

  } else if (
    score >=
    42
  ) {

    alert =
      side ===
        "EV SAHİBİ"
        ? "EV BASKISI"
        : side ===
            "DEPLASMAN"
          ? "DEPLASMAN BASKISI"
          : "BASKI";

    alertLevel =
      1;

  }

  /* -------------------------------------------------------
     GOL SONRASI
     Geriye dönük GOL SİNYALİ YOK.
     Fakat yüzde de 69/82 gibi kilitlenmez.
  ------------------------------------------------------- */

  if (
    afterGoal
  ) {

    if (
      tm.homeStrong
    ) {

      alert =
        "EV BASIYOR";

      alertLevel =
        2;

    } else if (
      tm.awayStrong
    ) {

      alert =
        "DEPLASMAN BASIYOR";

      alertLevel =
        2;

    } else if (
      score >=
      50
    ) {

      alert =
        "BASKI";

      alertLevel =
        1;

    }

  }

  const dangerousLabel =
    !s.hasDangerous

      ? "VERİ YOK"

      : recentDanger >=
          14

        ? "ÇOK GÜÇLÜ ARTIŞ"

        : recentDanger >=
            10

          ? "GÜÇLÜ ARTIŞ"

          : recentDanger >=
              6

            ? "ARTIYOR"

            : recentDanger >=
                3

              ? "HAREKETLİ"

              : totalDanger >=
                  40

                ? "YÜKSEK HACİM"

                : "NORMAL";

  reasons.sort(
    (
      a,
      b
    ) =>
      b.points -
      a.points
  );

  return {

    percentage:
      score,

    level:
      score >=
        90
        ? "ÇOK YÜKSEK"
        : score >=
            80
          ? "YÜKSEK"
          : score >=
              65
            ? "ORTA-YÜKSEK"
            : score >=
                45
              ? "ORTA"
              : "DÜŞÜK",

    alert,

    alertLevel,

    side,

    afterGoal,

    preGoalSide:
      homePreGoal
        ? "EV SAHİBİ"
        : awayPreGoal
          ? "DEPLASMAN"
          : side,

    last10Ready:
      ready,

    dangerousAttacks:
      totalDanger,

    recentDangerousAttacks:
      recentDanger,

    dangerousLabel,

    reasons:
      reasons.slice(
        0,
        8
      ),

    raw: {

      minute,

      totalShots,

      totalOnTarget:
        totalOn,

      totalCorners,

      totalXg,

      totalDangerous:
        totalDanger,

      recentShots,

      recentOnTarget:
        recentOn,

      recentCorners,

      recentXg,

      recentDangerous:
        recentDanger,

      shortShots,

      shortOnTarget:
        shortOn,

      shortDangerous:
        shortDanger,

      shortXg,

      pressure:
        strongestPressure,

      homePressure:
        tm.homePct,

      awayPressure:
        tm.awayPct,

      homeStrong:
        tm.homeStrong,

      awayStrong:
        tm.awayStrong,

      homeCardRisk,

      awayCardRisk,

      homeYellow:
        num(
          cards?.home?.yellow
        ),

      awayYellow:
        num(
          cards?.away?.yellow
        ),

      homeRed:
        num(
          cards?.home?.red
        ),

      awayRed:
        num(
          cards?.away?.red
        )

    }

  };
}

/* =========================================================
   ANALİZ
========================================================= */

async function analyzeFixture(
  fixture
) {

  const id =
    fixture
      ?.fixture
      ?.id;

  if (
    !id
  ) {
    return null;
  }

  const scoreInfo =
    trackScore(
      id,
      fixture
    );

  const raw =
    await getStatistics(
      id,
      scoreInfo.changed
    );

  const stats =
    parseStatistics(
      raw,
      fixture
    );

  const list =
    saveSnapshot(
      id,
      stats,
      fixture
    );

  const pressure =
    getPressure(
      stats,
      list
    );

  const teamPressure =
    getTeamPressure(
      stats,
      pressure
    );

  const events =
    await getFixtureEvents(
      id
    );

  const cards =
    await getCardAnalysis(
      fixture,
      events
    );

  const signal =
    calculateSignal(
      fixture,
      stats,
      pressure,
      teamPressure,
      scoreInfo,
      cards
    );

  signal.trend =
    getTrend(
      id,
      signal.percentage
    );

  signal.snapshotCount =
    list.length;

  signal.windowMinutes =
    pressure.window;

  const data = {

    fixture: {

      id,

      status:
        fixture
          ?.fixture
          ?.status ||
        null

    },

    league: {

      name:
        fixture
          ?.league
          ?.name ||
        "Bilinmeyen lig",

      country:
        fixture
          ?.league
          ?.country ||
        ""

    },

    teams: {

      home:
        fixture
          ?.teams
          ?.home ||
        {},

      away:
        fixture
          ?.teams
          ?.away ||
        {}

    },

    live: {

      minute:
        num(
          fixture
            ?.fixture
            ?.status
            ?.elapsed
        ),

      score: {

        home:
          num(
            fixture
              ?.goals
              ?.home
          ),

        away:
          num(
            fixture
              ?.goals
              ?.away
          )

      },

      statistics:
        stats,

      statisticsAvailable:
        !!stats.available,

      cards,

      last10: {

        pressure,

        snapshots:
          list.length

      },

      teamPressure,

      scoreInfo,

      signal,

      dominantTeam:
        teamPressure.dominant ===
          "home"

          ? fixture
              ?.teams
              ?.home
              ?.name

          : teamPressure.dominant ===
              "away"

            ? fixture
                ?.teams
                ?.away
                ?.name

            : "EŞİT"

    }

  };

  resultMap.set(
    String(id),
    {
      data,
      time:
        Date.now()
    }
  );

  return data;
}

/* =========================================================
   MONİTÖR
========================================================= */

async function updateMonitor() {

  if (
    busy
  ) {
    return;
  }

  busy =
    true;

  try {

    const fixtures =
      await getLiveFixtures();

    const active =
      new Set();

    for (
      const fixture
      of fixtures
    ) {

      const id =
        fixture
          ?.fixture
          ?.id;

      if (
        !id
      ) {
        continue;
      }

      active.add(
        String(id)
      );

      try {

        await analyzeFixture(
          fixture
        );

      } catch (
        error
      ) {

        console.log(
          `⚠️ Maç ${id}: ${error.message}`
        );

      }

    }

    for (
      const id
      of resultMap.keys()
    ) {

      if (
        !active.has(
          id
        )
      ) {

        resultMap.delete(
          id
        );

        snapshotMap.delete(
          id
        );

        statsCache.delete(
          id
        );

        eventsCache.delete(
          id
        );

        lineupsCache.delete(
          id
        );

        trendMap.delete(
          id
        );

        scoreMap.delete(
          id
        );

      }

    }

    lastUpdate =
      Date.now();

    lastError =
      null;

    console.log(
      `⚽ Canlı: ${fixtures.length} | Analiz: ${resultMap.size} | API: ${apiRemaining ?? "?"}`
    );

  } catch (
    error
  ) {

    lastError =
      error.message;

    console.error(
      "❌ Monitor:",
      error.message
    );

  } finally {

    busy =
      false;

  }

}

/* =========================================================
   API LIVE
========================================================= */

app.get(
  "/api/live",
  (
    req,
    res
  ) => {

    res.json({

      success:
        true,

      count:
        resultMap.size,

      updatedAt:
        lastUpdate,

      apiRemaining,

      matches:
        Array.from(
          resultMap.values()
        ).map(
          x =>
            x.data
        )

    });

  }
);

/* =========================================================
   HEALTH
========================================================= */

app.get(
  "/api/health",
  (
    req,
    res
  ) => {

    res.json({

      success:
        true,

      status:
        "online",

      matches:
        resultMap.size,

      busy,

      apiRemaining,

      lastUpdate,

      lastError

    });

  }
);

/* =========================================================
   MANUEL REFRESH
========================================================= */

app.post(
  "/api/refresh",
  async (
    req,
    res
  ) => {

    await updateMonitor();

    res.json({

      success:
        true,

      count:
        resultMap.size

    });

  }
);

/* =========================================================
   TEK MAÇ
========================================================= */

app.get(
  "/api/live/:id",
  (
    req,
    res
  ) => {

    const item =
      resultMap.get(
        String(
          req.params.id
        )
      );

    if (
      !item
    ) {

      return res
        .status(404)
        .json({

          success:
            false,

          error:
            "Maç bulunamadı"

        });

    }

    res.json({

      success:
        true,

      match:
        item.data

    });

  }
);

/* =========================================================
   WEB PANEL
========================================================= */

app.get(
  "/",
  (
    req,
    res
  ) => {

    const html =

`<!doctype html>

<html lang="tr">

<head>

<meta charset="utf-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1"
>

<title>VOLKI AI</title>

<style>

*{
  box-sizing:border-box;
}

body{
  margin:0;
  background:#080a0f;
  color:#fff;
  font:13px Arial,Helvetica,sans-serif;
  padding:14px;
}

.wrap{
  max-width:1500px;
  margin:auto;
}

.top{
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:10px;
  margin-bottom:12px;
  padding:8px 2px;
}

.title{
  font-size:21px;
  font-weight:900;
}

.subtitle{
  color:#8893a3;
  font-size:11px;
  margin-top:2px;
}

.muted{
  color:#8993a3;
  font-size:11px;
}

.grid{
  display:grid;
  grid-template-columns:
    repeat(
      auto-fit,
      minmax(310px,1fr)
    );
  gap:10px;
}

.card{
  background:#10141b;
  border:1px solid #252c36;
  border-radius:12px;
  padding:10px;
}

.card.rising{
  border-color:#18aa5c;
  box-shadow:
    0 0 0 1px
    rgba(
      24,
      170,
      92,
      .12
    );
}

.card.teamalert{
  border-color:#e0a62d;
  box-shadow:
    0 0 10px
    rgba(
      224,
      166,
      45,
      .10
    );
}

.card.goal{
  border-color:#ff334d;
  box-shadow:
    0 0 18px
    rgba(
      255,
      51,
      77,
      .22
    );
}

@keyframes golBlink{

  0%,100%{
    opacity:1;
  }

  50%{
    opacity:.35;
  }

}

.goalblink{
  animation:
    golBlink
    .8s infinite;

  background:#641522;
}

.head{
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:8px;
  margin-bottom:6px;
}

.league{
  min-width:0;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
  color:#7f8a9b;
  font-size:10px;
}

.badge{
  padding:4px 7px;
  border-radius:7px;
  background:#1a2029;
  font-size:10px;
  font-weight:900;
  white-space:nowrap;
}

.badge.rising{
  background:#0e3a24;
  color:#61f39b;
}

.badge.team{
  background:#4b3516;
  color:#ffd071;
}

.teams{
  display:grid;
  grid-template-columns:
    1fr
    auto
    1fr;
  align-items:center;
  gap:8px;
  margin:7px 0 9px;
}

.teamname{
  font-weight:800;
  font-size:12px;
  min-width:0;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}

.right{
  text-align:right;
}

.score{
  text-align:center;
  font-size:20px;
  font-weight:900;
}

.signalbox{
  display:flex;
  align-items:center;
  gap:8px;
  background:#0c1016;
  border:1px solid #202731;
  border-radius:9px;
  padding:7px 8px;
  margin-bottom:7px;
}

.signalnum{
  font-size:22px;
  line-height:1;
  font-weight:900;
}

.signalmeta{
  min-width:0;
  flex:1;
}

.level{
  font-size:10px;
  font-weight:900;
}

.reason{
  color:#717c8d;
  font-size:9px;
  margin-top:2px;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}

.ctx{
  display:grid;
  grid-template-columns:
    repeat(
      4,
      minmax(0,1fr)
    );
  gap:5px;
}

.ctx div{
  background:#171c24;
  border-radius:7px;
  padding:6px 4px;
  text-align:center;
  color:#aab3c0;
  font-size:9px;
  min-width:0;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}

.bar{
  height:5px;
  background:#2b313b;
  border-radius:10px;
  overflow:hidden;
  display:flex;
  margin:7px 0 8px;
}

.homebar{
  background:#00e676;
}

.awaybar{
  background:#ff4965;
}

.stats{
  display:grid;
  grid-template-columns:
    repeat(
      6,
      minmax(0,1fr)
    );
  gap:5px;
}

.stat{
  background:#171c24;
  border-radius:7px;
  padding:5px 3px;
  text-align:center;
  color:#8d97a7;
  font-size:8px;
}

.stat b{
  display:block;
  color:#fff;
  font-size:10px;
  margin-top:2px;
}

.cards{
  margin-top:8px;
  background:#0c1016;
  border:1px solid #202731;
  border-radius:9px;
  padding:8px;
}

.cards-title{
  display:flex;
  justify-content:space-between;
  align-items:center;
  color:#c8d0dc;
  font-size:10px;
  font-weight:900;
  margin-bottom:7px;
}

.cards-grid{
  display:grid;
  grid-template-columns:
    1fr
    1fr;
  gap:6px;
}

.cards-team{
  background:#171c24;
  border-radius:7px;
  padding:7px;
  min-width:0;
}

.cards-team-name{
  font-size:10px;
  font-weight:900;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}

.cards-counts{
  display:flex;
  gap:5px;
  margin-top:5px;
}

.yellow{
  background:#d9ad00;
  color:#171300;
  border-radius:5px;
  padding:3px 6px;
  font-size:9px;
  font-weight:900;
}

.red{
  background:#d9283a;
  color:#fff;
  border-radius:5px;
  padding:3px 6px;
  font-size:9px;
  font-weight:900;
}

.card-player{
  margin-top:5px;
  padding-top:5px;
  border-top:1px solid #252c36;
  color:#9fa9b8;
  font-size:9px;
  line-height:1.35;
}

.card-analysis{
  margin-top:5px;
  color:#c3ccd8;
  font-size:9px;
  line-height:1.4;
}

.card-risk{
  color:#ffd071;
  font-size:9px;
  margin-top:4px;
}

.empty{
  text-align:center;
  color:#8993a3;
  padding:60px 10px;
}

@media(max-width:700px){

  body{
    padding:8px;
  }

  .grid{
    grid-template-columns:
      1fr;
  }

  .ctx{
    grid-template-columns:
      repeat(
        2,
        1fr
      );
  }

  .stats{
    grid-template-columns:
      repeat(
        3,
        1fr
      );
  }

  .cards-grid{
    grid-template-columns:
      1fr;
  }

  .top{
    flex-direction:column;
    align-items:flex-start;
  }

}

</style>

</head>

<body>

<div class="wrap">

<div class="top">

<div>

<div class="title">
⚽ VOLKI AI
</div>

<div class="subtitle">
Yükselenler üstte • Anlık baskı • Erken 0-15 dk sinyali
</div>

</div>

<div
  class="muted"
  id="updated"
>
Yükleniyor...
</div>

</div>

<div
  id="app"
  class="grid"
></div>

</div>

<script>

function esc(
  value
){

  return String(
    value == null
      ? ""
      : value
  )
  .replaceAll(
    "&",
    "&amp;"
  )
  .replaceAll(
    "<",
    "&lt;"
  )
  .replaceAll(
    ">",
    "&gt;"
  )
  .replaceAll(
    '"',
    "&quot;"
  )
  .replaceAll(
    "'",
    "&#039;"
  );

}

function drawCard(
  m
){

  const l =
    m.live;

  const s =
    l.statistics;

  const h =
    s.home;

  const a =
    s.away;

  const p =
    l.last10.pressure;

  const g =
    l.signal;

  const tp =
    l.teamPressure;

  const cards =
    l.cards ||
    {};

  const rising =
    g.trend &&
    g.trend.trend ===
      "RISING";

  const goal =
    Number(
      g.alertLevel ||
      0
    ) >=
      3 &&
    !g.afterGoal;

  const teamAlert =
    Number(
      g.alertLevel ||
      0
    ) ===
      2 &&
    !goal;

  const hp =
    p.ready
      ? p.homePct
      : (
          tp.homePct ||
          50
        );

  const ap =
    p.ready
      ? p.awayPct
      : (
          tp.awayPct ||
          50
        );

  let cardClass =
    "card";

  if(
    rising
  ){
    cardClass +=
      " rising";
  }

  if(
    teamAlert
  ){
    cardClass +=
      " teamalert";
  }

  if(
    goal
  ){
    cardClass +=
      " goal";
  }

  let badgeClass =
    "badge";

  if(
    rising
  ){
    badgeClass +=
      " rising";
  }

  if(
    teamAlert
  ){
    badgeClass +=
      " team";
  }

  if(
    goal
  ){
    badgeClass +=
      " goalblink";
  }

  let badgeText;

  if(
    goal
  ){

    badgeText =
      "⚡ GOL SİNYALİ";

  }else if(
    g.alert &&
    g.alert !==
      "NORMAL"
  ){

    badgeText =
      g.alert;

  }else if(
    rising
  ){

    badgeText =
      "↑ YÜKSELİYOR";

  }else if(
    g.trend &&
    g.trend.trend ===
      "FALLING"
  ){

    badgeText =
      "↓ DÜŞÜYOR";

  }else if(
    g.trend &&
    g.trend.trend ===
      "STABLE"
  ){

    badgeText =
      "→ SABİT";

  }else{

    badgeText =
      "• YENİ";

  }

  const reason =
    g.reasons &&
    g.reasons.length
      ? g.reasons[0].label
      : "Veri birikiyor";

  const change =
    Number(
      g.trend &&
      g.trend.change ||
      0
    );

  return (

    "<div class='" +
      cardClass +
    "'>" +

      "<div class='head'>" +

        "<div class='league'>" +
          esc(
            m.league.name
          ) +
          " • " +
          esc(
            m.league.country
          ) +
        "</div>" +

        "<div class='" +
          badgeClass +
        "'>" +
          esc(
            badgeText
          ) +
        "</div>" +

      "</div>" +

      "<div class='teams'>" +

        "<div class='teamname'>" +
          esc(
            m.teams.home.name ||
            "Ev sahibi"
          ) +
        "</div>" +

        "<div class='score'>" +

          l.score.home +
          " - " +
          l.score.away +

          "<div class='muted'>" +
            l.minute +
            " dk" +
          "</div>" +

        "</div>" +

        "<div class='teamname right'>" +
          esc(
            m.teams.away.name ||
            "Deplasman"
          ) +
        "</div>" +

      "</div>" +

      "<div class='signalbox'>" +

        "<div class='signalnum'>" +
          "%" +
          Number(
            g.percentage ||
            0
          ) +
        "</div>" +

        "<div class='signalmeta'>" +

          "<div class='level'>" +
            esc(
              g.level ||
              "DÜŞÜK"
            ) +
          "</div>" +

          "<div class='reason'>" +
            esc(
              reason
            ) +
          "</div>" +

        "</div>" +

        "<div class='muted'>" +
          "Δ " +
          (
            change >=
              0
              ? "+"
              : ""
          ) +
          change +
        "</div>" +

      "</div>" +

      "<div class='ctx'>" +

        "<div>" +
          "🔥 " +
          g.dangerousAttacks +
        "</div>" +

        "<div>" +
          "📈 +" +
          g.recentDangerousAttacks +
        "</div>" +

        "<div>" +
          "🎯 " +
          esc(
            g.preGoalSide ||
            l.dominantTeam ||
            "EŞİT"
          ) +
        "</div>" +

        "<div>" +
          "⚡ " +
          esc(
            g.dangerousLabel ||
            "NORMAL"
          ) +
        "</div>" +

        "<div>" +
          "🟨🟥 Ev " +
          Number(
            cards.home &&
            cards.home.yellow ||
            0
          ) +
          "/" +
          Number(
            cards.home &&
            cards.home.red ||
            0
          ) +
        "</div>" +

        "<div>" +
          "🟨🟥 Dep " +
          Number(
            cards.away &&
            cards.away.yellow ||
            0
          ) +
          "/" +
          Number(
            cards.away &&
            cards.away.red ||
            0
          ) +
        "</div>" +

      "</div>" +

      "<div class='bar'>" +

        "<div" +
          " class='homebar'" +
          " style='width:" +
          hp +
          "%'>" +
        "</div>" +

        "<div" +
          " class='awaybar'" +
          " style='width:" +
          ap +
          "%'>" +
        "</div>" +

      "</div>" +

      "<div class='stats'>" +

        "<div class='stat'>" +
          "Şut" +
          "<b>" +
            h.shots +
            "-" +
            a.shots +
          "</b>" +
        "</div>" +

        "<div class='stat'>" +
          "İsabet" +
          "<b>" +
            h.on +
            "-" +
            a.on +
          "</b>" +
        "</div>" +

        "<div class='stat'>" +
          "Korner" +
          "<b>" +
            h.corners +
            "-" +
            a.corners +
          "</b>" +
        "</div>" +

        "<div class='stat'>" +
          "xG" +
          "<b>" +
            Number(
              h.xg ||
              0
            ).toFixed(2) +
            "-" +
            Number(
              a.xg ||
              0
            ).toFixed(2) +
          "</b>" +
        "</div>" +

        "<div class='stat'>" +
          "Tehlikeli" +
          "<b>" +
            h.dangerous +
            "-" +
            a.dangerous +
          "</b>" +
        "</div>" +

        "<div class='stat'>" +
          "Kart" +
          "<b>" +
            "🟨 " +
            Number(
              cards.home &&
              cards.home.yellow ||
              0
            ) +
            "-" +
            Number(
              cards.away &&
              cards.away.yellow ||
              0
            ) +
            " | 🟥 " +
            Number(
              cards.home &&
              cards.home.red ||
              0
            ) +
            "-" +
            Number(
              cards.away &&
              cards.away.red ||
              0
            ) +
          "</b>" +
        "</div>" +

      "</div>" +

      "<div class='cards'>" +

        "<div class='cards-title'>" +

          "<span>🟨🟥 KART DURUMU</span>" +

          "<span>" +
            (
              cards.available
                ? "Güncel"
                : "VERİ YOK"
            ) +
          "</span>" +

        "</div>" +

        "<div class='cards-grid'>" +

          "<div class='cards-team'>" +

            "<div class='cards-team-name'>" +
              esc(
                m.teams.home.name ||
                "Ev sahibi"
              ) +
            "</div>" +

            "<div class='cards-counts'>" +

              "<span class='yellow'>" +
                "🟨 " +
                Number(
                  cards.home &&
                  cards.home.yellow ||
                  0
                ) +
              "</span>" +

              "<span class='red'>" +
                "🟥 " +
                Number(
                  cards.home &&
                  cards.home.red ||
                  0
                ) +
              "</span>" +

            "</div>" +

            (
              cards.home &&
              cards.home.players &&
              cards.home.players.length

                ? cards.home.players
                    .map(
                      function(
                        player
                      ){

                        return (
                          "<div class='card-player'>" +
                            (
                              player.type ===
                              "RED"
                                ? "🟥"
                                : "🟨"
                            ) +
                            " " +
                            esc(
                              player.name
                            ) +
                            " · " +
                            esc(
                              player.position ||
                              "BİLİNMİYOR"
                            ) +
                            " · " +
                            esc(
                              player.minute
                            ) +
                            "'" +
                            (
                              player.stillOnPitch
                                ? ""
                                : " · ÇIKTI"
                            ) +
                          "</div>"
                        );

                      }
                    )
                    .join("")

                : "<div class='card-player'>Kartlı oyuncu yok.</div>"
            ) +

            "<div class='card-analysis'>" +
              esc(
                cards.home &&
                cards.home.analysis ||
                "Kart verisi yok."
              ) +
            "</div>" +

            "<div class='card-risk'>" +
              "Sinyal etkisi: " +
              Number(
                cards.home &&
                cards.home.risk ||
                0
              ) +
            "</div>" +

          "</div>" +

          "<div class='cards-team'>" +

            "<div class='cards-team-name'>" +
              esc(
                m.teams.away.name ||
                "Deplasman"
              ) +
            "</div>" +

            "<div class='cards-counts'>" +

              "<span class='yellow'>" +
                "🟨 " +
                Number(
                  cards.away &&
                  cards.away.yellow ||
                  0
                ) +
              "</span>" +

              "<span class='red'>" +
                "🟥 " +
                Number(
                  cards.away &&
                  cards.away.red ||
                  0
                ) +
              "</span>" +

            "</div>" +

            (
              cards.away &&
              cards.away.players &&
              cards.away.players.length

                ? cards.away.players
                    .map(
                      function(
                        player
                      ){

                        return (
                          "<div class='card-player'>" +
                            (
                              player.type ===
                              "RED"
                                ? "🟥"
                                : "🟨"
                            ) +
                            " " +
                            esc(
                              player.name
                            ) +
                            " · " +
                            esc(
                              player.position ||
                              "BİLİNMİYOR"
                            ) +
                            " · " +
                            esc(
                              player.minute
                            ) +
                            "'" +
                            (
                              player.stillOnPitch
                                ? ""
                                : " · ÇIKTI"
                            ) +
                          "</div>"
                        );

                      }
                    )
                    .join("")

                : "<div class='card-player'>Kartlı oyuncu yok.</div>"
            ) +

            "<div class='card-analysis'>" +
              esc(
                cards.away &&
                cards.away.analysis ||
                "Kart verisi yok."
              ) +
            "</div>" +

            "<div class='card-risk'>" +
              "Sinyal etkisi: " +
              Number(
                cards.away &&
                cards.away.risk ||
                0
              ) +
            "</div>" +

          "</div>" +

        "</div>" +

      "</div>" +

    "</div>"

  );

}

async function load(){

  try{

    const response =
      await fetch(
        "/api/live?x=" +
        Date.now(),
        {
          cache:
            "no-store"
        }
      );

    const json =
      await response.json();

    const matches =
      Array.isArray(
        json.matches
      )
        ? json.matches.slice()
        : [];

    matches.sort(
      function(
        a,
        b
      ){

        const aGoal =
          Number(
            a.live.signal &&
            a.live.signal.alertLevel ||
            0
          ) >=
            3 &&
          !(
            a.live.signal &&
            a.live.signal.afterGoal
          );

        const bGoal =
          Number(
            b.live.signal &&
            b.live.signal.alertLevel ||
            0
          ) >=
            3 &&
          !(
            b.live.signal &&
            b.live.signal.afterGoal
          );

        if(
          bGoal !==
          aGoal
        ){

          return (
            Number(bGoal) -
            Number(aGoal)
          );

        }

        const aRise =
          a.live.signal &&
          a.live.signal.trend &&
          a.live.signal.trend.trend ===
            "RISING"
            ? 1
            : 0;

        const bRise =
          b.live.signal &&
          b.live.signal.trend &&
          b.live.signal.trend.trend ===
            "RISING"
            ? 1
            : 0;

        if(
          bRise !==
          aRise
        ){

          return (
            bRise -
            aRise
          );

        }

        const aLevel =
          Number(
            a.live.signal &&
            a.live.signal.alertLevel ||
            0
          );

        const bLevel =
          Number(
            b.live.signal &&
            b.live.signal.alertLevel ||
            0
          );

        if(
          bLevel !==
          aLevel
        ){

          return (
            bLevel -
            aLevel
          );

        }

        const aValue =
          Number(
            a.live.signal &&
            a.live.signal.percentage ||
            0
          );

        const bValue =
          Number(
            b.live.signal &&
            b.live.signal.percentage ||
            0
          );

        return (
          bValue -
          aValue
        );

      }
    );

    document
      .getElementById(
        "app"
      )
      .innerHTML =
      matches.length
        ? matches
            .map(
              drawCard
            )
            .join("")
        : "<div class='empty'>⚽ Canlı maç yok.</div>";

    document
      .getElementById(
        "updated"
      )
      .textContent =
      "Güncelleme: " +
      new Date()
        .toLocaleTimeString(
          "tr-TR"
        );

  }catch(
    error
  ){

    console.error(
      error
    );

    document
      .getElementById(
        "app"
      )
      .innerHTML =
      "<div class='empty'>❌ Canlı veri alınamadı.</div>";

  }

}

load();

setInterval(
  load,
  5000
);

</script>

</body>

</html>`;

    res
      .type(
        "html"
      )
      .send(
        html
      );

  }
);

/* =========================================================
   HATALAR
========================================================= */

process.on(
  "unhandledRejection",
  function(
    error
  ){

    console.error(
      "❌ UNHANDLED:",
      error
    );

  }
);

process.on(
  "uncaughtException",
  function(
    error
  ){

    console.error(
      "❌ UNCAUGHT:",
      error
    );

  }
);

/* =========================================================
   SERVER
========================================================= */

app.listen(
  PORT,
  "0.0.0.0",
  async function(){

    console.log("");

    console.log(
      "======================================"
    );

    console.log(
      "⚽ VOLKI AI CANLI ANALİZ"
    );

    console.log(
      "======================================"
    );

    console.log(
      "🌐 http://localhost:" +
      PORT
    );

    console.log(
      "📡 /api/live"
    );

    console.log(
      "❤️ /api/health"
    );

    console.log(
      "======================================"
    );

    await updateMonitor();

    setInterval(
      updateMonitor,
      LIVE_REFRESH_MS
    );

  }
);
