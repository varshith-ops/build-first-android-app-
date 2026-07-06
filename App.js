import React, { useState, useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  StyleSheet, Text, View, TouchableOpacity, SafeAreaView, Dimensions, Animated,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

const { width: SW, height: SH } = Dimensions.get('window');
const SHIP_W = 70, SHIP_H = 80, SHIP_Y = SH - 260;

// ── Physics ──────────────────────────────────────────────────────────────
const ACCEL = 0.85, MAX_SPD = 9.5, FRICTION = 0.88;
const NORMAL_GS = 1.0, MAX_GS = 2.2, MIN_GS = 0.3;
const GS_UP = 0.04, GS_DOWN = 0.03, GS_RETURN = 0.025;

// ── Game constants ────────────────────────────────────────────────────────
const AST_SIZE      = 50;
const INIT_SPD      = 5.0;
const MAX_LIVES     = 3;
const INVULN_F      = 120;   // 2 s
const POWERUP_SZ    = 28;
const SHIELD_DUR_F  = 180;   // 3 s
const SHAKE_F       = 18;
const BULLET_SPD    = 14;
const FIRE_INTERVAL      = 500;  // ms between shots (normal)
const RAPID_FIRE_INTERVAL = 160;  // ms between shots (rapid fire)
const RAPID_FIRE_DUR_F    = 300;  // ~5 s at 60fps
const COIN_SZ       = 18;
const COMBO_TIERS   = [{ min: 15, mult: 3 }, { min: 10, mult: 2 }, { min: 5, mult: 1.5 }, { min: 0, mult: 1 }];
const NEAR_MISS_PX  = 22;

// ── Starfield ─────────────────────────────────────────────────────────────
const INIT_STARS = [
  ...Array.from({ length: 18 }, (_, i) => ({ id: `b${i}`, x: Math.random() * SW, y: Math.random() * SH, size: Math.random() * 1.2 + 0.4, spd: Math.random() * 0.6 + 0.3, layer: 0 })),
  ...Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, x: Math.random() * SW, y: Math.random() * SH, size: Math.random() * 1.5 + 1.0, spd: Math.random() * 1.2 + 0.9, layer: 1 })),
  ...Array.from({ length: 4 },  (_, i) => ({ id: `f${i}`, x: Math.random() * SW, y: Math.random() * SH, size: Math.random() * 2.0 + 2.0, spd: Math.random() * 2.0 + 2.0, layer: 2 })),
];

// ── Asteroid factory ──────────────────────────────────────────────────────
const AST_TYPES = ['regular', 'armored', 'comet'];
const makeAst = (id, yOff = 0) => {
  const rnd = Math.random();
  const type = rnd < 0.6 ? 'regular' : rnd < 0.82 ? 'armored' : 'comet';
  const isComet = type === 'comet';
  const sz = isComet ? AST_SIZE * 0.65 : type === 'armored' ? AST_SIZE * 1.2 : AST_SIZE;
  return {
    id, type, sz,
    hp: type === 'armored' ? 2 : 1,
    x: Math.random() * (SW - sz), y: -sz - yOff,
    spdM: isComet ? 1.7 + Math.random() * 0.5 : 0.85 + Math.random() * 0.35,
    aX: (Math.random() - 0.5) * (isComet ? 1.2 : 2.5),
    rot: Math.random() * 360,
    rotSpd: (Math.random() > 0.5 ? 1 : -1) * (Math.random() * 3 + 1),
    hit: false,   // flash when armored takes first hit
    hitFrames: 0,
  };
};

export default function App() {
  // ── State ───────────────────────────────────────────────────────────────
  const [playing,    setPlaying]    = useState(false);
  const [paused,     setPaused]     = useState(false);
  const [gameOver,   setGameOver]   = useState(false);
  const [score,      setScore]      = useState(0);
  const [hiScore,    setHiScore]    = useState(0);
  const [lives,      setLives]      = useState(MAX_LIVES);
  const [wave,       setWave]       = useState(1);
  const [dist,       setDist]       = useState(0);
  const [bestDist,   setBestDist]   = useState(0);
  const [coins,      setCoins]      = useState(0);
  const [totalCoins, setTotalCoins] = useState(0);
  const [combo,      setCombo]      = useState(0);
  const [comboMult,  setComboMult]  = useState(1);
  const [shipX,      setShipX]      = useState(SW / 2 - SHIP_W / 2);
  const [shipTilt,   setShipTilt]   = useState(0);
  const [asteroids,  setAsteroids]  = useState([makeAst(1), makeAst(2, 300)]);
  const [bullets,    setBullets]    = useState([]);
  const [powerups,   setPowerups]   = useState([]);
  const [coinDrops,  setCoinDrops]  = useState([]);
  const [debris,     setDebris]     = useState([]);
  const [particles,  setParticles]  = useState([]); // thruster trail
  const [stars,      setStars]      = useState(INIT_STARS);
  const [pulse,      setPulse]      = useState(false);
  const [boosting,   setBoosting]   = useState(false);
  const [braking,    setBraking]    = useState(false);
  const [explosion,  setExplosion]  = useState({ active: false, x: 0, y: 0, r: 0 });
  const [shake,      setShake]      = useState({ x: 0, y: 0 });
  const [invuln,     setInvuln]     = useState(0);
  const [shield,     setShield]     = useState(0);
  const [rapidFire,  setRapidFire]  = useState(0); // countdown frames
  const [waveText,   setWaveText]   = useState('');
  const [waveFlash,  setWaveFlash]  = useState(false);
  const [nearMiss,   setNearMiss]   = useState('');
  const [gameSpd,    setGameSpd]    = useState(NORMAL_GS);
  const [lastScore,  setLastScore]  = useState(0);
  const [newDistRecord, setNewDistRecord] = useState(false);

  // ── Refs ────────────────────────────────────────────────────────────────
  const leftRef    = useRef(false), rightRef = useRef(false);
  const boostRef   = useRef(false), brakeRef = useRef(false);
  const velRef     = useRef(0),     shipXRef = useRef(SW / 2 - SHIP_W / 2);
  const scoreRef   = useRef(0),     hiRef    = useRef(0);
  const livesRef   = useRef(MAX_LIVES);
  const explRef    = useRef(false);
  const gsRef      = useRef(NORMAL_GS);
  const invRef     = useRef(0);
  const shieldRef    = useRef(0);
  const rapidFireRef = useRef(0);
  const distRef    = useRef(0);
  const bestRef    = useRef(0);
  const waveRef    = useRef(1);
  const shakeRef   = useRef(0);
  const pauseRef   = useRef(false);
  const comboRef   = useRef(0);
  const coinRef    = useRef(0);
  const totalCoinRef = useRef(0);
  const lastFireRef  = useRef(0);
  const frameRef     = useRef(0);

  // ── Load persistent data ─────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [hs, bd, tc] = await Promise.all([
          AsyncStorage.getItem('hi_score'),
          AsyncStorage.getItem('best_dist'),
          AsyncStorage.getItem('total_coins'),
        ]);
        if (hs) { const v = +hs; setHiScore(v); hiRef.current = v; }
        if (bd) { const v = +bd; setBestDist(v); bestRef.current = v; }
        if (tc) { const v = +tc; setTotalCoins(v); totalCoinRef.current = v; }
      } catch (_) {}
    })();
  }, []);

  const saveRecords = async (s, d, c) => {
    try {
      const newHi = s > hiRef.current;
      const newBest = d > bestRef.current;
      if (newHi) { hiRef.current = s; setHiScore(s); await AsyncStorage.setItem('hi_score', String(s)); }
      if (newBest) { bestRef.current = d; setBestDist(d); await AsyncStorage.setItem('best_dist', String(d)); setNewDistRecord(true); }
      const newTotal = totalCoinRef.current + c;
      totalCoinRef.current = newTotal;
      setTotalCoins(newTotal);
      await AsyncStorage.setItem('total_coins', String(newTotal));
    } catch (_) {}
  };

  const getWave = (s) => s >= 20 ? 3 : s >= 10 ? 2 : 1;
  const getAstCount = (w) => w + 1;
  const getComboMult = (c) => COMBO_TIERS.find(t => c >= t.min)?.mult ?? 1;

  // ── Start game ───────────────────────────────────────────────────────────
  const startGame = () => {
    setPlaying(true); setGameOver(false); setPaused(false); pauseRef.current = false;
    setScore(0); scoreRef.current = 0;
    setLives(MAX_LIVES); livesRef.current = MAX_LIVES;
    setWave(1); waveRef.current = 1;
    setDist(0); distRef.current = 0;
    setCoins(0); coinRef.current = 0;
    setCombo(0); comboRef.current = 0; setComboMult(1);
    setNewDistRecord(false);
    leftRef.current = rightRef.current = boostRef.current = brakeRef.current = false;
    velRef.current = 0; explRef.current = false;
    gsRef.current = NORMAL_GS; setGameSpd(NORMAL_GS);
    invRef.current = 0; setInvuln(0);
    shieldRef.current = 0; setShield(0);
    rapidFireRef.current = 0; setRapidFire(0);
    shakeRef.current = 0; setShake({ x: 0, y: 0 });
    setExplosion({ active: false, x: 0, y: 0, r: 0 });
    setShipTilt(0); setBoosting(false); setBraking(false);
    setDebris([]); setParticles([]); setPowerups([]); setCoinDrops([]);
    setBullets([]); setWaveText(''); setWaveFlash(false); setNearMiss('');
    const ix = SW / 2 - SHIP_W / 2;
    setShipX(ix); shipXRef.current = ix;
    setAsteroids([makeAst(1), makeAst(2, 300)]);
    lastFireRef.current = 0; frameRef.current = 0;
    setLastScore(score);
  };

  // ── Hit handler ──────────────────────────────────────────────────────────
  const handleHit = (cx, cy) => {
    if (invRef.current > 0 || shieldRef.current > 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    const newLives = livesRef.current - 1;
    livesRef.current = newLives; setLives(newLives);
    shakeRef.current = SHAKE_F;
    // Debris
    const d = Array.from({ length: 8 }, (_, i) => ({
      id: Date.now() + i, x: cx, y: cy,
      angle: (i / 8) * Math.PI * 2, spd: 3 + Math.random() * 3,
      life: 1.0, sz: 4 + Math.random() * 5,
      color: ['#ff6600','#ff3300','#ffaa00','#ff0044'][i % 4],
    }));
    setDebris(prev => [...prev, ...d]);
    // Reset combo
    comboRef.current = 0; setCombo(0); setComboMult(1);

    if (newLives <= 0) {
      explRef.current = true;
      setExplosion({ active: true, x: cx, y: cy, r: 10 });
      let r = 10;
      const ei = setInterval(() => {
        r += 8;
        if (r > 70) { clearInterval(ei); setGameOver(true); saveRecords(scoreRef.current, Math.floor(distRef.current), coinRef.current); }
        else setExplosion(p => ({ ...p, r }));
      }, 45);
    } else {
      invRef.current = INVULN_F; setInvuln(INVULN_F);
    }
  };

  const collectPU = (pu) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (pu.type === 'shield') { shieldRef.current = SHIELD_DUR_F; setShield(SHIELD_DUR_F); }
    else if (pu.type === 'rapidfire') { rapidFireRef.current = RAPID_FIRE_DUR_F; setRapidFire(RAPID_FIRE_DUR_F); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); }
    else { const ns = scoreRef.current + 5; scoreRef.current = ns; setScore(ns); }
  };

  const collectCoin = () => {
    Haptics.selectionAsync();
    coinRef.current++; setCoins(c => c + 1);
  };

  const togglePause = () => {
    Haptics.selectionAsync();
    const next = !pauseRef.current;
    pauseRef.current = next; setPaused(next);
  };

  // ── MAIN GAME LOOP ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!playing || gameOver) return;
    const interval = setInterval(() => {
      if (pauseRef.current) return;
      frameRef.current++;
      const now = Date.now();

      // ── Screen shake ──
      if (shakeRef.current > 0) {
        shakeRef.current--;
        setShake({ x: (Math.random() - 0.5) * 12, y: (Math.random() - 0.5) * 12 });
        if (shakeRef.current === 0) setShake({ x: 0, y: 0 });
      }

      // ── Counters ──
      if (invRef.current > 0) { invRef.current--; setInvuln(invRef.current); }
      if (shieldRef.current > 0) { shieldRef.current--; setShield(shieldRef.current); }
      if (rapidFireRef.current > 0) { rapidFireRef.current--; setRapidFire(rapidFireRef.current); }

      // ── Flight speed ──
      let gs = gsRef.current;
      if (boostRef.current) gs = Math.min(MAX_GS, gs + GS_UP);
      else if (brakeRef.current) gs = Math.max(MIN_GS, gs - GS_DOWN);
      else { gs = gs > NORMAL_GS ? Math.max(NORMAL_GS, gs - GS_RETURN) : Math.min(NORMAL_GS, gs + GS_RETURN); }
      gsRef.current = gs; setGameSpd(gs);

      // ── Distance ──
      distRef.current += gs * 0.55;
      setDist(Math.floor(distRef.current));

      // ── Ship physics ──
      let vel = velRef.current;
      if (leftRef.current) vel = Math.max(-MAX_SPD, vel - ACCEL);
      else if (rightRef.current) vel = Math.min(MAX_SPD, vel + ACCEL);
      else { vel *= FRICTION; if (Math.abs(vel) < 0.1) vel = 0; }
      velRef.current = vel;
      let nx = shipXRef.current + vel;
      if (nx < 0) { nx = 0; velRef.current = 0; }
      if (nx > SW - SHIP_W) { nx = SW - SHIP_W; velRef.current = 0; }
      shipXRef.current = nx; setShipX(nx);
      setShipTilt(p => p + ((-vel * 2.2) - p) * 0.18);

      // ── Stars ──
      setStars(prev => prev.map(s => {
        // During boost: stars stretch (we handle width in render)
        let ny = s.y + s.spd * gs;
        if (ny > SH) return { ...s, y: -10, x: Math.random() * SW };
        return { ...s, y: ny };
      }));
      setPulse(p => !p);

      // ── Auto-fire bullets (rapid fire reduces interval) ──
      const activeInterval = rapidFireRef.current > 0 ? RAPID_FIRE_INTERVAL : FIRE_INTERVAL;
      if (now - lastFireRef.current >= activeInterval) {
        lastFireRef.current = now;
        const bx = shipXRef.current + SHIP_W / 2 - 3;
        const isRapid = rapidFireRef.current > 0;
        if (isRapid) {
          // Fire 3 spread bullets during rapid fire
          setBullets(prev => [...prev,
            { id: now,       x: bx,     y: SHIP_Y - 10, rapid: true },
            { id: now + 0.1, x: bx - 8, y: SHIP_Y - 4,  rapid: true },
            { id: now + 0.2, x: bx + 8, y: SHIP_Y - 4,  rapid: true },
          ]);
        } else {
          setBullets(prev => [...prev, { id: now, x: bx, y: SHIP_Y - 10, rapid: false }]);
        }
      }

      // ── Move bullets ──
      setBullets(prev => prev.filter(b => b.y > -20).map(b => ({ ...b, y: b.y - BULLET_SPD })));

      // ── Thruster trail particles ──
      if (frameRef.current % 2 === 0) {
        const px = shipXRef.current + SHIP_W / 2 + (Math.random() - 0.5) * 8;
        const py = SHIP_Y + SHIP_H - 10;
        setParticles(prev => [
          ...prev.slice(-20),
          { id: now + Math.random(), x: px, y: py, life: 1.0, size: 3 + Math.random() * 3, boosting: boostRef.current },
        ]);
      }
      setParticles(prev => prev.map(p => ({ ...p, y: p.y + 2, life: p.life - 0.07 })).filter(p => p.life > 0));

      // ── Debris ──
      setDebris(prev =>
        prev.map(d => ({ ...d, x: d.x + Math.cos(d.angle) * d.spd, y: d.y + Math.sin(d.angle) * d.spd, life: d.life - 0.035 }))
            .filter(d => d.life > 0)
      );

      // ── Coin drops ──
      setCoinDrops(prev => {
        const sx = shipXRef.current, sy = SHIP_Y;
        return prev
          .map(c => ({ ...c, y: c.y + 2.5 * gs }))
          .filter(c => {
            if (c.y > SH) return false;
            if (c.x < sx + SHIP_W && c.x + COIN_SZ > sx && c.y < sy + SHIP_H && c.y + COIN_SZ > sy) {
              collectCoin(); return false;
            }
            return true;
          });
      });

      // ── Power-ups ──
      setPowerups(prev => {
        const sx = shipXRef.current, sy = SHIP_Y;
        return prev
          .map(p => ({ ...p, y: p.y + 2.8 * gs }))
          .filter(p => {
            if (p.y > SH) return false;
            if (p.x < sx + SHIP_W && p.x + POWERUP_SZ > sx && p.y < sy + SHIP_H && p.y + POWERUP_SZ > sy) {
              collectPU(p); return false;
            }
            return true;
          });
      });

      // ── Wave check ──
      const cw = getWave(scoreRef.current);
      if (cw !== waveRef.current) {
        waveRef.current = cw;
        setWave(cw);
        setWaveFlash(true);
        setWaveText(`WAVE ${cw}!`);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setTimeout(() => { setWaveFlash(false); setWaveText(''); }, 2000);
        setAsteroids(prev => {
          const needed = getAstCount(cw);
          if (prev.length < needed) {
            return [...prev, ...Array.from({ length: needed - prev.length }, (_, i) => makeAst(prev.length + i + 1, Math.random() * 400))];
          }
          return prev;
        });
      }

      // ── Asteroids ──
      const baseSpd = INIT_SPD + Math.min(6.5, scoreRef.current * 0.18);

      setAsteroids(prev => {
        const nextAsts = [];
        let newPUs = [], newCoins = [], nearMissTriggered = false;

        prev.forEach(ast => {
          let { x: ax, y: ay, aX, rot, rotSpd, sz, spdM, hp, hitFrames } = ast;
          const spd = baseSpd * spdM * gs;
          let nextY = ay + spd;
          let nextX = ax + aX * gs;
          if (nextX < 0) { nextX = 0; aX = -aX; }
          if (nextX > SW - sz) { nextX = SW - sz; aX = -aX; }
          const nextRot = (rot + rotSpd * gs) % 360;
          if (hitFrames > 0) hitFrames--;

          // Passed bottom → reset
          if (nextY > SH - 80) {
            const ns = scoreRef.current + 1;
            scoreRef.current = ns; setScore(ns);
            // combo increment
            comboRef.current++; setCombo(comboRef.current);
            const mult = getComboMult(comboRef.current); setComboMult(mult);
            // power-up spawn (shield 35%, star 35%, rapidfire 30%)
            if (Math.random() < 0.13) {
              const rnd = Math.random();
              const type = rnd < 0.35 ? 'shield' : rnd < 0.70 ? 'star' : 'rapidfire';
              newPUs.push({ id: Date.now() + Math.random(), type, x: Math.random() * (SW - POWERUP_SZ), y: -POWERUP_SZ });
            }
            nextAsts.push(makeAst(ast.id, 0));
            return;
          }

          // Near-miss check
          const sx = shipXRef.current, sy = SHIP_Y;
          const closeX = nextX < sx + SHIP_W + NEAR_MISS_PX && nextX + sz > sx - NEAR_MISS_PX;
          const closeY = nextY < sy + SHIP_H + NEAR_MISS_PX && nextY + sz > sy - NEAR_MISS_PX;
          const hit    = nextX < sx + SHIP_W && nextX + sz > sx && nextY < sy + SHIP_H && nextY + sz > sy;
          if (!hit && closeX && closeY && !nearMissTriggered) {
            nearMissTriggered = true;
            setNearMiss('NEAR MISS! +1');
            scoreRef.current += 1; setScore(scoreRef.current);
            setTimeout(() => setNearMiss(''), 900);
          }

          if (hit && !explRef.current) handleHit(sx + SHIP_W / 2, sy + SHIP_H / 2);

          nextAsts.push({ ...ast, x: nextX, y: nextY, aX, rotation: nextRot, rot: nextRot, rotSpd, hitFrames });
        });

        if (newPUs.length) setPowerups(p => [...p, ...newPUs]);
        if (newCoins.length) setCoinDrops(p => [...p, ...newCoins]);
        return nextAsts;
      });

      // ── Bullet vs Asteroid collision ──
      setBullets(prevBullets => {
        let remaining = [...prevBullets];
        setAsteroids(prevAsts => {
          let updatedAsts = [...prevAsts];
          remaining = remaining.filter(b => {
            let hit = false;
            updatedAsts = updatedAsts.map(ast => {
              if (hit) return ast;
              if (b.x > ast.x && b.x < ast.x + ast.sz && b.y > ast.y && b.y < ast.y + ast.sz) {
                hit = true;
                const newHp = ast.hp - 1;
                if (newHp <= 0) {
                  // Destroyed
                  const pts = Math.round((ast.type === 'comet' ? 3 : ast.type === 'armored' ? 2 : 1) * getComboMult(comboRef.current));
                  scoreRef.current += pts; setScore(scoreRef.current);
                  comboRef.current++; setCombo(comboRef.current); setComboMult(getComboMult(comboRef.current));
                  // Coin drop
                  if (Math.random() < 0.5) {
                    setCoinDrops(p => [...p, { id: Date.now() + Math.random(), x: ast.x + ast.sz / 2 - COIN_SZ / 2, y: ast.y }]);
                  }
                  // Debris
                  const d = Array.from({ length: 5 }, (_, i) => ({
                    id: Date.now() + i, x: ast.x + ast.sz / 2, y: ast.y + ast.sz / 2,
                    angle: (i / 5) * Math.PI * 2, spd: 2 + Math.random() * 2.5, life: 0.9,
                    sz: 3 + Math.random() * 4, color: ast.type === 'comet' ? '#00d4ff' : '#ff8800',
                  }));
                  setDebris(p => [...p, ...d]);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  return makeAst(ast.id, Math.random() * 200);
                } else {
                  return { ...ast, hp: newHp, hitFrames: 8 };
                }
              }
              return ast;
            });
            return !hit;
          });
          return updatedAsts;
        });
        return remaining;
      });

    }, 16);
    return () => clearInterval(interval);
  }, [playing, gameOver]);

  // ── Derived render values ─────────────────────────────────────────────────
  const gs = gsRef.current;
  const curSpd = Math.abs(velRef.current);
  const pct = Math.round(gs * 100);
  const mainFH = 14 + curSpd * 1.5 + gs * 12 + (pulse ? 5 : 0);
  const sideFH = 8  + curSpd * 0.8 + gs * 8  + (pulse ? 3 : 0);
  const shipVis = invuln === 0 || Math.floor(invuln / 4) % 2 === 0;
  const comboColor = comboMult >= 3 ? '#ff007f' : comboMult >= 2 ? '#ff9500' : comboMult >= 1.5 ? '#ffcc00' : '#ffffff';

  // ── Warp lines (12 lines radiating from center during boost) ──────────────
  const WARP_LINES = boosting ? Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 12) * Math.PI * 2;
    const len = 60 + gs * 80;
    const cx = SW / 2, cy = SH / 2;
    return { id: i, x1: cx, y1: cy, x2: cx + Math.cos(angle) * len, y2: cy + Math.sin(angle) * len, angle };
  }) : [];

  // ── Asteroid renderer ─────────────────────────────────────────────────────
  const renderAst = (ast) => {
    const isComet  = ast.type === 'comet';
    const isArmor  = ast.type === 'armored';
    const flashNow = ast.hitFrames > 0;
    return (
      <View key={ast.id} style={[styles.astWrap, { left: ast.x, top: ast.y, width: ast.sz + 16, height: ast.sz + 16, transform: [{ rotate: `${ast.rot ?? 0}deg` }] }]}>
        {/* Flame tongues */}
        {[0,45,90,135,180,225,270,315].map((a, i) => (
          <View key={i} style={[styles.fTongue, {
            top: i === 0 ? -6 : i === 4 ? undefined : '50%',
            bottom: i === 4 ? -6 : undefined,
            left: i === 6 ? -4 : i === 0 || i === 4 ? '50%' : undefined,
            right: i === 2 ? -4 : undefined,
            marginLeft: (i === 0 || i === 4) ? -3 : 0,
            marginTop: (i === 2 || i === 6) ? -5 : 0,
            ...(i === 1 && { top: 2, right: -2 }),
            ...(i === 3 && { bottom: 2, right: -2 }),
            ...(i === 5 && { bottom: 2, left: -2 }),
            ...(i === 7 && { top: 2, left: -2 }),
            height: pulse ? 14 - (i % 2) * 4 : 10 + (i % 2) * 4,
            opacity: pulse ? (i % 2 === 0 ? 1 : 0.6) : (i % 2 === 0 ? 0.6 : 1),
            backgroundColor: isComet ? '#00d4ff' : '#ff8c00',
            transform: [{ rotate: `${a}deg` }],
          }]} />
        ))}
        {/* Aura */}
        <View style={[styles.burnAura, {
          width: ast.sz + 8, height: ast.sz + 8, borderRadius: (ast.sz + 8) / 2,
          borderColor: isComet ? 'rgba(0,212,255,0.5)' : 'rgba(255,140,0,0.4)',
          backgroundColor: isComet ? 'rgba(0,180,255,0.12)' : 'rgba(255,100,0,0.18)',
          shadowColor: isComet ? '#00c8ff' : '#ff6600',
        }]} />
        {/* Rock body */}
        <View style={[styles.rockCenter, {
          width: ast.sz * 0.72, height: ast.sz * 0.64,
          backgroundColor: flashNow ? '#ffffff' : isComet ? '#1a4a6b' : isArmor ? '#3a3a4a' : '#4a3f3a',
          borderColor: isComet ? '#00a8d4' : isArmor ? '#7a7a9a' : '#6b5d52',
        }]} />
        <View style={[styles.rockB1, { backgroundColor: isComet ? '#1e5578' : isArmor ? '#454560' : '#524840' }]} />
        <View style={[styles.rockB2, { backgroundColor: isComet ? '#163d58' : isArmor ? '#3d3d50' : '#463c36' }]} />
        <View style={[styles.rockB3, { backgroundColor: isComet ? '#1a4a6b' : isArmor ? '#424258' : '#504540' }]} />
        <View style={[styles.rockB4, { backgroundColor: isComet ? '#124060' : isArmor ? '#383850' : '#443a35' }]} />
        {/* Armored rivet details */}
        {isArmor && <View style={styles.rivet1} />}
        {isArmor && <View style={styles.rivet2} />}
        {/* Craters */}
        <View style={styles.crA} />
        <View style={styles.crB} />
        <View style={styles.sLight} />
        {/* Comet glow core */}
        {isComet && <View style={styles.cometCore} />}
      </View>
    );
  };

  // ── UI ────────────────────────────────────────────────────────────────────
  return (
    <LinearGradient colors={['#06040d', '#100b2b', '#030206']} style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />

        {/* ── Deep space background decorations ── */}
        {/* Nebula cloud */}
        <View style={styles.nebula} />
        {/* Planet */}
        <View style={styles.planet}>
          <View style={styles.planetRing} />
          <View style={styles.planetHighlight} />
        </View>

        {/* Stars */}
        {stars.map(s => (
          <View key={s.id} style={[styles.star, {
            left: s.x, top: s.y,
            width: boosting ? s.size * 0.8 : s.size,
            height: boosting ? s.size + gs * 12 : s.size,
            borderRadius: boosting ? 1 : s.size / 2,
            opacity: s.layer === 0 ? 0.35 : s.layer === 1 ? 0.65 : 0.95,
          }]} />
        ))}

        {/* ── MENU ── */}
        {!playing ? (
          <View style={styles.menu}>
            <Text style={styles.title}>SPACE ESCAPE</Text>
            <Text style={styles.subtitle}>RUNNER</Text>

            {/* Best Distance record */}
            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>BEST SCORE</Text>
                <Text style={styles.statVal}>{hiScore}</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>BEST DIST</Text>
                <Text style={styles.statVal}>{bestDist.toLocaleString()} m</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>💰 COINS</Text>
                <Text style={styles.statVal}>{totalCoins}</Text>
              </View>
            </View>

            {lastScore > 0 && (
              <Text style={styles.lastScore}>Last run: {lastScore} pts</Text>
            )}

            <TouchableOpacity style={styles.btn} onPress={startGame}>
              <Text style={styles.btnTxt}>🚀 START GAME</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={[styles.gameWrap, { transform: [{ translateX: shake.x }, { translateY: shake.y }] }]}>

            {/* ── Warp speed lines ── */}
            {WARP_LINES.map(l => (
              <View key={l.id} style={{
                position: 'absolute',
                left: l.x1, top: l.y1,
                width: Math.hypot(l.x2 - l.x1, l.y2 - l.y1),
                height: 1.5,
                backgroundColor: 'rgba(255,255,255,0.25)',
                transform: [{ rotate: `${l.angle}rad` }],
                transformOrigin: '0% 50%',
                zIndex: 1,
              }} />
            ))}

            {/* ── HUD ── */}
            <View style={styles.hud}>
              <View style={styles.hudL}>
                <Text style={styles.hudScore}>Score: {score}</Text>
                <Text style={styles.hudDist}>{dist.toLocaleString()} m</Text>
              </View>
              <View style={styles.hudC}>
                <View style={styles.livesRow}>
                  {Array.from({ length: MAX_LIVES }, (_, i) => (
                    <Text key={i} style={{ fontSize: 14, opacity: i < lives ? 1 : 0.2 }}>❤️</Text>
                  ))}
                </View>
                <View style={styles.hudMeta}>
                  <Text style={[styles.hudSpd, { color: gs > 1.1 ? '#00e1ff' : gs < 0.9 ? '#ff3366' : '#00d4ff' }]}>{pct}%</Text>
                  <Text style={styles.hudWave}>W{wave}</Text>
                  <Text style={styles.hudCoins}>💰{coins}</Text>
                  {rapidFire > 0 && <Text style={styles.hudRapid}>⚡RAPID</Text>}
                </View>
              </View>
              <View style={styles.hudR}>
                <TouchableOpacity style={styles.pauseBtn} onPress={togglePause}>
                  <Text style={{ fontSize: 14 }}>⏸</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.quitBtn} onPress={() => setPlaying(false)}>
                  <Text style={styles.quitTxt}>QUIT</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Combo display */}
            {comboMult > 1 && (
              <View style={styles.comboWrap}>
                <Text style={[styles.comboTxt, { color: comboColor }]}>×{comboMult} COMBO ({combo})</Text>
              </View>
            )}

            {/* Rapid Fire bar */}
            {rapidFire > 0 && (
              <View style={styles.rapidBarWrap}>
                <View style={[styles.rapidBarFill, { width: `${(rapidFire / RAPID_FIRE_DUR_F) * 100}%` }]} />
              </View>
            )}

            {/* Shield bar */}
            {shield > 0 && (
              <View style={styles.shieldBarWrap}>
                <View style={[styles.shieldBarFill, { width: `${(shield / SHIELD_DUR_F) * 100}%` }]} />
              </View>
            )}

            {/* Play area */}
            <View style={styles.play}>

              {/* Wave flash overlay */}
              {waveFlash && <View style={styles.waveFlashOverlay} />}
              {waveText !== '' && (
                <View style={styles.waveAnn}>
                  <Text style={styles.waveAnnTxt}>{waveText}</Text>
                </View>
              )}

              {/* Near miss */}
              {nearMiss !== '' && (
                <View style={[styles.nearMissWrap, { left: shipXRef.current - 20, top: SHIP_Y - 35 }]}>
                  <Text style={styles.nearMissTxt}>{nearMiss}</Text>
                </View>
              )}

              {/* Asteroids */}
              {!(explosion.active && livesRef.current <= 0) && asteroids.map(renderAst)}

              {/* Coins */}
              {coinDrops.map(c => (
                <View key={c.id} style={[styles.coinDrop, { left: c.x, top: c.y }]}>
                  <Text style={styles.coinEmoji}>🪙</Text>
                </View>
              ))}

              {/* Power-ups */}
              {powerups.map(pu => (
                <View key={pu.id} style={[styles.puWrap, { left: pu.x, top: pu.y }]}>
                  {pu.type === 'shield'
                    ? <View style={styles.shieldOrb}><Text style={styles.puIcon}>🛡️</Text></View>
                    : pu.type === 'rapidfire'
                    ? <View style={styles.rapidOrb}><Text style={styles.puIcon}>⚡</Text></View>
                    : <View style={styles.starOrb}><Text style={styles.puIcon}>⭐</Text></View>}
                </View>
              ))}

              {/* Bullets */}
              {bullets.map(b => (
                <View key={b.id} style={[styles.bullet, { left: b.x, top: b.y }]}>
                  <View style={[styles.bulletGlow, b.rapid && styles.bulletRapid]} />
                </View>
              ))}

              {/* Thruster trail particles */}
              {particles.map(p => (
                <View key={p.id} style={[styles.trailPart, {
                  left: p.x, top: p.y, width: p.size, height: p.size,
                  borderRadius: p.size / 2, opacity: p.life,
                  backgroundColor: p.boosting ? '#00d4ff' : '#ff9500',
                  shadowColor: p.boosting ? '#00d4ff' : '#ff6600',
                }]} />
              ))}

              {/* Debris */}
              {debris.map(d => (
                <View key={d.id} style={[styles.debris, { left: d.x - d.sz / 2, top: d.y - d.sz / 2, width: d.sz, height: d.sz, opacity: d.life, backgroundColor: d.color }]} />
              ))}

              {/* Spaceship */}
              {!(explosion.active && livesRef.current <= 0) && shipVis && (
                <View style={[styles.ship, { left: shipX, top: SHIP_Y, transform: [{ rotate: `${shipTilt}deg` }] }]}>
                  {shield > 0 && <View style={styles.shieldRing} />}
                  {/* Main flame */}
                  <View style={[styles.mFlame, { height: mainFH, bottom: -mainFH + 2, backgroundColor: gs > 1.5 ? '#00e1ff' : gs < 0.7 ? '#ff6622' : '#4dc9f6', shadowColor: '#00c8ff' }]}>
                    <View style={[styles.mFlameCore, { height: mainFH * 0.55 }]} />
                  </View>
                  {/* Left nacelle */}
                  <View style={styles.lNac}>
                    <View style={[styles.sFlame, { height: sideFH, bottom: -sideFH + 1 }]}><View style={[styles.sFlameCore, { height: sideFH * 0.5 }]} /></View>
                    <View style={styles.nacelle}><View style={styles.nacNose} /><View style={styles.nacEx} /></View>
                  </View>
                  {/* Right nacelle */}
                  <View style={styles.rNac}>
                    <View style={[styles.sFlame, { height: sideFH, bottom: -sideFH + 1 }]}><View style={[styles.sFlameCore, { height: sideFH * 0.5 }]} /></View>
                    <View style={styles.nacelle}><View style={styles.nacNose} /><View style={styles.nacEx} /></View>
                  </View>
                  {/* Wings */}
                  <View style={styles.lWing}><View style={styles.wingRed} /></View>
                  <View style={styles.rWing}><View style={styles.wingRed} /></View>
                  <View style={styles.accL} /><View style={styles.accR} />
                  {/* Fuselage */}
                  <View style={styles.fuselage}>
                    <View style={styles.seam1} /><View style={styles.seam2} />
                    <View style={styles.vL} /><View style={styles.vR} />
                  </View>
                  <View style={styles.cockpit}><View style={styles.glare} /></View>
                  <View style={styles.noseB} /><View style={styles.noseT} />
                  <View style={styles.exhaust} />
                </View>
              )}

              {/* Explosion ring */}
              {explosion.active && livesRef.current <= 0 && (
                <View style={[styles.explRing, { left: explosion.x - explosion.r, top: explosion.y - explosion.r, width: explosion.r * 2, height: explosion.r * 2, borderRadius: explosion.r }]} />
              )}

              {/* ── Controls ── */}
              <View style={styles.ctrlWrap}>
                <View style={styles.ctrlTop}>
                  <TouchableOpacity style={[styles.boostBtn, boosting && styles.boostActive]}
                    onPressIn={() => { boostRef.current = true; setBoosting(true); Haptics.selectionAsync(); }}
                    onPressOut={() => { boostRef.current = false; setBoosting(false); }}>
                    <Text style={styles.boostTxt}>⚡ BOOST</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.ctrlBot}>
                  <TouchableOpacity style={styles.ctrlBtn}
                    onPressIn={() => { leftRef.current = true; }}
                    onPressOut={() => { leftRef.current = false; }}>
                    <Text style={styles.ctrlTxt}>◀</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.brakeBtn, braking && styles.brakeActive]}
                    onPressIn={() => { brakeRef.current = true; setBraking(true); Haptics.selectionAsync(); }}
                    onPressOut={() => { brakeRef.current = false; setBraking(false); }}>
                    <Text style={styles.brakeTxt}>BRAKE</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.ctrlBtn}
                    onPressIn={() => { rightRef.current = true; }}
                    onPressOut={() => { rightRef.current = false; }}>
                    <Text style={styles.ctrlTxt}>▶</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* ── PAUSE OVERLAY ── */}
        {paused && (
          <View style={styles.overlay}>
            <Text style={styles.pauseTitle}>PAUSED</Text>
            <Text style={styles.pauseSub}>Score: {score}  ·  {dist.toLocaleString()} m  ·  💰{coins}</Text>
            <TouchableOpacity style={styles.resumeBtn} onPress={togglePause}>
              <Text style={styles.resumeTxt}>▶ RESUME</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setPaused(false); pauseRef.current = false; setPlaying(false); }}>
              <Text style={styles.exitTxt}>EXIT TO MENU</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── GAME OVER ── */}
        {gameOver && (
          <View style={styles.overlay}>
            <Text style={styles.goTitle}>GAME OVER</Text>
            {newDistRecord && <Text style={styles.recordTxt}>🏆 NEW DISTANCE RECORD!</Text>}
            <Text style={styles.goDist}>{dist.toLocaleString()} m traveled</Text>
            <View style={styles.goBoard}>
              <View style={styles.goCol}><Text style={styles.goLabel}>SCORE</Text><Text style={styles.goVal}>{score}</Text></View>
              <View style={styles.goDivider} />
              <View style={styles.goCol}><Text style={styles.goLabel}>BEST</Text><Text style={styles.goVal}>{hiScore}</Text></View>
              <View style={styles.goDivider} />
              <View style={styles.goCol}><Text style={styles.goLabel}>💰</Text><Text style={styles.goVal}>{coins}</Text></View>
            </View>
            <TouchableOpacity style={styles.btn} onPress={startGame}>
              <Text style={styles.btnTxt}>PLAY AGAIN</Text>
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>
    </LinearGradient>
  );
}

const S = StyleSheet.create;
const styles = S({
  container: { flex: 1 },
  safe: { flex: 1 },

  // Space environment
  nebula: { position: 'absolute', top: SH * 0.05, left: SW * 0.1, width: SW * 0.8, height: SH * 0.35, borderRadius: SW * 0.4, backgroundColor: 'rgba(80,40,160,0.07)', shadowColor: '#7040ff', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.3, shadowRadius: 40 },
  planet: { position: 'absolute', top: 60, right: 30, width: 52, height: 52, borderRadius: 26, backgroundColor: '#2a3555', borderWidth: 1, borderColor: '#3a4a70', justifyContent: 'center', alignItems: 'center' },
  planetRing: { position: 'absolute', width: 72, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: 'rgba(100,130,200,0.35)', top: 19 },
  planetHighlight: { position: 'absolute', top: 10, left: 12, width: 14, height: 10, borderRadius: 5, backgroundColor: 'rgba(100,140,220,0.22)' },

  star: { position: 'absolute', backgroundColor: '#fff' },

  // Menu
  menu: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, zIndex: 1 },
  title: { fontSize: 40, fontWeight: '900', color: '#00ffff', letterSpacing: 4, textShadowColor: 'rgba(0,255,255,0.5)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 16 },
  subtitle: { fontSize: 26, fontWeight: '700', color: '#ff007f', letterSpacing: 6, marginBottom: 30, textShadowColor: 'rgba(255,0,127,0.5)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 14 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statBox: { flex: 1, backgroundColor: 'rgba(27,23,48,0.85)', borderWidth: 1, borderColor: '#3f376b', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 8, alignItems: 'center' },
  statLabel: { fontSize: 9, color: '#a09bb8', letterSpacing: 1.5, fontWeight: '600', marginBottom: 4 },
  statVal: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  lastScore: { color: '#665577', fontSize: 13, marginBottom: 20, letterSpacing: 1 },
  btn: { backgroundColor: '#ff007f', paddingVertical: 18, paddingHorizontal: 50, borderRadius: 30, shadowColor: '#ff007f', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.5, shadowRadius: 15, elevation: 8 },
  btnTxt: { color: '#fff', fontSize: 18, fontWeight: 'bold', letterSpacing: 2 },

  // HUD
  gameWrap: { flex: 1, zIndex: 1 },
  hud: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, paddingVertical: 8, backgroundColor: 'rgba(20,16,40,0.75)', borderBottomWidth: 1, borderColor: '#3f376b' },
  hudL: { flex: 1 },
  hudC: { flex: 1, alignItems: 'center' },
  hudR: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end', gap: 6 },
  hudScore: { fontSize: 16, fontWeight: 'bold', color: '#00ffff' },
  hudDist: { fontSize: 10, color: '#7788aa', fontWeight: '600', letterSpacing: 1 },
  livesRow: { flexDirection: 'row', gap: 2 },
  hudMeta: { flexDirection: 'row', gap: 8, marginTop: 2 },
  hudSpd: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  hudWave: { fontSize: 10, fontWeight: '800', color: '#ff9500', letterSpacing: 1 },
  hudCoins: { fontSize: 10, fontWeight: '800', color: '#ffcc00' },
  hudRapid: { fontSize: 10, fontWeight: '900', color: '#ff4400', letterSpacing: 1 },
  pauseBtn: { backgroundColor: 'rgba(0,212,255,0.12)', paddingVertical: 4, paddingHorizontal: 9, borderRadius: 10, borderWidth: 1, borderColor: '#00d4ff' },
  quitBtn: { backgroundColor: 'rgba(255,0,127,0.18)', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: '#ff007f' },
  quitTxt: { color: '#ff007f', fontWeight: 'bold', fontSize: 10 },

  // Combo
  comboWrap: { alignItems: 'center', paddingVertical: 3, backgroundColor: 'rgba(0,0,0,0.3)' },
  comboTxt: { fontSize: 12, fontWeight: '900', letterSpacing: 2 },

  // Rapid Fire bar
  rapidBarWrap: { height: 4, backgroundColor: 'rgba(255,100,0,0.1)', marginHorizontal: 20, borderRadius: 2, marginBottom: 2 },
  rapidBarFill: { height: 4, backgroundColor: '#ff4400', borderRadius: 2, shadowColor: '#ff6600', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 6, elevation: 4 },

  // Shield bar
  shieldBarWrap: { height: 4, backgroundColor: 'rgba(0,212,255,0.1)', marginHorizontal: 20, borderRadius: 2 },
  shieldBarFill: { height: 4, backgroundColor: '#00d4ff', borderRadius: 2, shadowColor: '#00d4ff', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 4 },

  // Play area
  play: { flex: 1, position: 'relative', overflow: 'hidden' },
  waveFlashOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,0.15)', zIndex: 60 },
  waveAnn: { position: 'absolute', top: '28%', left: 0, right: 0, alignItems: 'center', zIndex: 61 },
  waveAnnTxt: { fontSize: 34, fontWeight: '900', color: '#ff9500', letterSpacing: 4, textShadowColor: 'rgba(255,149,0,0.7)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 20 },
  nearMissWrap: { position: 'absolute', zIndex: 55, alignItems: 'center' },
  nearMissTxt: { fontSize: 13, fontWeight: '900', color: '#ffee00', letterSpacing: 2, textShadowColor: 'rgba(255,238,0,0.6)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 8 },

  // Bullets
  bullet: { position: 'absolute', width: 6, height: 20, zIndex: 20, alignItems: 'center', justifyContent: 'center' },
  bulletGlow: { width: 4, height: 18, borderRadius: 2, backgroundColor: '#00ffff', shadowColor: '#00ffff', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 1, shadowRadius: 8, elevation: 10 },
  bulletRapid: { backgroundColor: '#ff4400', shadowColor: '#ff4400', width: 5, height: 22 },

  // Thruster particles
  trailPart: { position: 'absolute', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 4, elevation: 5, zIndex: 8 },

  // Coin drop
  coinDrop: { position: 'absolute', width: COIN_SZ, height: COIN_SZ, justifyContent: 'center', alignItems: 'center', zIndex: 18 },
  coinEmoji: { fontSize: 14 },

  // Power-ups
  puWrap: { position: 'absolute', width: POWERUP_SZ, height: POWERUP_SZ, justifyContent: 'center', alignItems: 'center', zIndex: 16 },
  shieldOrb: { width: POWERUP_SZ, height: POWERUP_SZ, borderRadius: POWERUP_SZ / 2, backgroundColor: 'rgba(0,212,255,0.2)', borderWidth: 2, borderColor: '#00d4ff', justifyContent: 'center', alignItems: 'center', shadowColor: '#00d4ff', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 8 },
  starOrb:   { width: POWERUP_SZ, height: POWERUP_SZ, borderRadius: POWERUP_SZ / 2, backgroundColor: 'rgba(255,200,0,0.2)',  borderWidth: 2, borderColor: '#ffcc00', justifyContent: 'center', alignItems: 'center', shadowColor: '#ffcc00', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 8 },
  rapidOrb:  { width: POWERUP_SZ, height: POWERUP_SZ, borderRadius: POWERUP_SZ / 2, backgroundColor: 'rgba(255,80,0,0.25)', borderWidth: 2, borderColor: '#ff4400', justifyContent: 'center', alignItems: 'center', shadowColor: '#ff6600', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 10, elevation: 8 },
  puIcon: { fontSize: 14 },

  // Debris
  debris: { position: 'absolute', borderRadius: 1, zIndex: 25 },

  // Shield ring around ship
  shieldRing: { position: 'absolute', width: SHIP_W + 18, height: SHIP_H + 18, borderRadius: (SHIP_W + 18) / 2, borderWidth: 2.5, borderColor: 'rgba(0,212,255,0.65)', top: -9, left: -9, shadowColor: '#00d4ff', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 12, zIndex: 30 },

  // Asteroid wrap
  astWrap: { position: 'absolute', justifyContent: 'center', alignItems: 'center' },
  fTongue: { position: 'absolute', width: 6, borderRadius: 3 },
  burnAura: { position: 'absolute', borderWidth: 2 },
  rockCenter: { position: 'absolute', borderRadius: 14, borderWidth: 1, zIndex: 5 },
  rockB1: { position: 'absolute', top: 6, left: 6, width: 20, height: 18, borderRadius: 8, zIndex: 4 },
  rockB2: { position: 'absolute', top: 4, right: 8, width: 16, height: 16, borderRadius: 7, zIndex: 4 },
  rockB3: { position: 'absolute', bottom: 6, left: 8, width: 18, height: 14, borderRadius: 6, zIndex: 4 },
  rockB4: { position: 'absolute', bottom: 4, right: 6, width: 20, height: 16, borderRadius: 9, zIndex: 4 },
  rivet1: { position: 'absolute', top: 10, left: 10, width: 4, height: 4, borderRadius: 2, backgroundColor: '#8888aa', zIndex: 7 },
  rivet2: { position: 'absolute', bottom: 10, right: 10, width: 4, height: 4, borderRadius: 2, backgroundColor: '#8888aa', zIndex: 7 },
  crA: { position: 'absolute', top: 14, left: 16, width: 10, height: 10, borderRadius: 5, backgroundColor: '#332b26', borderWidth: 0.8, borderColor: '#5a4f48', zIndex: 6 },
  crB: { position: 'absolute', bottom: 14, right: 14, width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#2e2622', zIndex: 6 },
  sLight: { position: 'absolute', top: 10, left: 12, width: 10, height: 6, borderRadius: 3, backgroundColor: 'rgba(140,120,100,0.38)', zIndex: 6 },
  cometCore: { position: 'absolute', width: 10, height: 10, borderRadius: 5, backgroundColor: 'rgba(0,220,255,0.5)', shadowColor: '#00d4ff', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 1, shadowRadius: 8, zIndex: 8 },

  // Spaceship
  ship: { position: 'absolute', width: SHIP_W, height: SHIP_H, justifyContent: 'center', alignItems: 'center' },
  fuselage: { width: 18, height: 50, backgroundColor: '#9eaab8', borderWidth: 1.5, borderColor: '#c0c8d0', borderTopLeftRadius: 5, borderTopRightRadius: 5, borderBottomLeftRadius: 3, borderBottomRightRadius: 3, zIndex: 15, position: 'absolute', top: 12 },
  seam1: { position: 'absolute', width: 16, height: 1, backgroundColor: '#6b7a8a', top: 20 },
  seam2: { position: 'absolute', width: 16, height: 1, backgroundColor: '#6b7a8a', top: 34 },
  vL: { position: 'absolute', width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#cc3333', top: 14, left: 2 },
  vR: { position: 'absolute', width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#cc3333', top: 14, right: 2 },
  noseB: { position: 'absolute', top: 2, width: 0, height: 0, borderLeftWidth: 9, borderRightWidth: 9, borderBottomWidth: 16, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#8a96a4', zIndex: 16 },
  noseT: { position: 'absolute', top: -2, width: 0, height: 0, borderLeftWidth: 4, borderRightWidth: 4, borderBottomWidth: 10, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#c0c8d0', zIndex: 17 },
  cockpit: { position: 'absolute', top: 18, width: 10, height: 16, backgroundColor: '#00d4ff', borderRadius: 5, borderWidth: 1.5, borderColor: '#33eeff', zIndex: 20, shadowColor: '#00d4ff', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 1, shadowRadius: 8, elevation: 10, alignItems: 'center' },
  glare: { width: 4, height: 6, backgroundColor: 'rgba(255,255,255,0.7)', borderRadius: 2, marginTop: 2 },
  accL: { position: 'absolute', left: 25, top: 10, width: 2, height: 52, backgroundColor: '#e67e22', borderRadius: 1, zIndex: 14, shadowColor: '#ff9500', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 3 },
  accR: { position: 'absolute', right: 25, top: 10, width: 2, height: 52, backgroundColor: '#e67e22', borderRadius: 1, zIndex: 14, shadowColor: '#ff9500', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 3 },
  lWing: { position: 'absolute', left: 8, bottom: 14, width: 18, height: 20, backgroundColor: '#4a5568', borderWidth: 1, borderColor: '#6b7a8a', borderTopLeftRadius: 6, borderBottomLeftRadius: 2, transform: [{ skewY: '-12deg' }], zIndex: 12, justifyContent: 'flex-end', alignItems: 'center', overflow: 'hidden' },
  rWing: { position: 'absolute', right: 8, bottom: 14, width: 18, height: 20, backgroundColor: '#4a5568', borderWidth: 1, borderColor: '#6b7a8a', borderTopRightRadius: 6, borderBottomRightRadius: 2, transform: [{ skewY: '12deg' }], zIndex: 12, justifyContent: 'flex-end', alignItems: 'center', overflow: 'hidden' },
  wingRed: { width: 12, height: 6, backgroundColor: '#cc2222', borderWidth: 0.5, borderColor: '#ff4444', marginBottom: 3, borderRadius: 1 },
  lNac: { position: 'absolute', left: -4, bottom: 8, alignItems: 'center', zIndex: 10 },
  rNac: { position: 'absolute', right: -4, bottom: 8, alignItems: 'center', zIndex: 10 },
  nacelle: { width: 10, height: 28, backgroundColor: '#6b7a8a', borderWidth: 1, borderColor: '#8a96a4', borderTopLeftRadius: 4, borderTopRightRadius: 4, borderBottomLeftRadius: 2, borderBottomRightRadius: 2, alignItems: 'center', justifyContent: 'space-between' },
  nacNose: { width: 6, height: 6, backgroundColor: '#9eaab8', borderTopLeftRadius: 3, borderTopRightRadius: 3, marginTop: 1 },
  nacEx: { width: 8, height: 3, backgroundColor: '#2d3748', borderBottomLeftRadius: 1.5, borderBottomRightRadius: 1.5 },
  exhaust: { position: 'absolute', bottom: 8, width: 10, height: 5, backgroundColor: '#2d3748', borderBottomLeftRadius: 3, borderBottomRightRadius: 3, zIndex: 14 },
  mFlame: { width: 8, position: 'absolute', borderRadius: 4, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.9, shadowRadius: 8, elevation: 10, zIndex: 3, alignItems: 'center' },
  mFlameCore: { width: 3, backgroundColor: '#fff', position: 'absolute', bottom: 2, borderRadius: 1.5 },
  sFlame: { width: 5, position: 'absolute', borderRadius: 2.5, backgroundColor: '#ff9500', shadowColor: '#ff6600', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.8, shadowRadius: 5, elevation: 8, zIndex: 3, alignItems: 'center' },
  sFlameCore: { width: 2, backgroundColor: '#ffe0a0', position: 'absolute', bottom: 1, borderRadius: 1 },

  // Controls
  ctrlWrap: { position: 'absolute', bottom: 22, left: 0, right: 0, alignItems: 'center' },
  ctrlTop: { marginBottom: 10 },
  ctrlBot: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12 },
  ctrlBtn: { backgroundColor: 'rgba(27,23,48,0.85)', borderWidth: 2, borderColor: '#00ffff', borderRadius: 30, paddingVertical: 14, paddingHorizontal: 30, shadowColor: '#00ffff', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5 },
  ctrlTxt: { color: '#00ffff', fontSize: 18, fontWeight: 'bold' },
  boostBtn: { backgroundColor: 'rgba(255,149,0,0.15)', borderWidth: 2, borderColor: '#ff9500', borderRadius: 25, paddingVertical: 10, paddingHorizontal: 35, shadowColor: '#ff9500', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
  boostActive: { backgroundColor: 'rgba(255,149,0,0.45)', shadowOpacity: 0.9, shadowRadius: 18 },
  boostTxt: { color: '#ff9500', fontSize: 14, fontWeight: 'bold', letterSpacing: 2 },
  brakeBtn: { backgroundColor: 'rgba(255,0,127,0.12)', borderWidth: 2, borderColor: '#ff3366', borderRadius: 25, paddingVertical: 12, paddingHorizontal: 22 },
  brakeActive: { backgroundColor: 'rgba(255,0,127,0.4)', shadowColor: '#ff3366', shadowOpacity: 0.9, shadowRadius: 15 },
  brakeTxt: { color: '#ff3366', fontSize: 13, fontWeight: 'bold', letterSpacing: 2 },

  // Overlays
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(6,4,13,0.94)', justifyContent: 'center', alignItems: 'center', padding: 20, zIndex: 100 },
  pauseTitle: { fontSize: 46, fontWeight: '900', color: '#00ffff', letterSpacing: 6, marginBottom: 8, textShadowColor: 'rgba(0,255,255,0.5)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 20 },
  pauseSub: { fontSize: 13, color: '#7788aa', marginBottom: 36, letterSpacing: 1 },
  resumeBtn: { backgroundColor: '#00d4ff', paddingVertical: 16, paddingHorizontal: 50, borderRadius: 30, marginBottom: 14, shadowColor: '#00d4ff', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.5, shadowRadius: 12 },
  resumeTxt: { color: '#06040d', fontSize: 18, fontWeight: 'bold', letterSpacing: 2 },
  exitTxt: { color: '#443355', fontSize: 13, fontWeight: '600', letterSpacing: 2, paddingVertical: 10 },
  goTitle: { fontSize: 46, fontWeight: '900', color: '#ff007f', letterSpacing: 4, marginBottom: 6, textShadowColor: 'rgba(255,0,127,0.5)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 16 },
  recordTxt: { fontSize: 16, color: '#ffcc00', fontWeight: '800', marginBottom: 4, letterSpacing: 1 },
  goDist: { fontSize: 13, color: '#7788aa', marginBottom: 18, letterSpacing: 1 },
  goBoard: { flexDirection: 'row', backgroundColor: 'rgba(27,23,48,0.8)', paddingVertical: 15, paddingHorizontal: 10, borderRadius: 15, borderWidth: 1, borderColor: '#3f376b', alignItems: 'center', marginBottom: 40, width: '90%', justifyContent: 'space-around' },
  goCol: { alignItems: 'center', flex: 1 },
  goDivider: { width: 1, height: '70%', backgroundColor: '#3f376b' },
  goLabel: { fontSize: 10, color: '#a09bb8', letterSpacing: 1.5, fontWeight: '600', marginBottom: 4 },
  goVal: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  explRing: { position: 'absolute', backgroundColor: 'rgba(255,100,0,0.35)', borderColor: '#ff8800', borderWidth: 3, shadowColor: '#ff4400', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 15, zIndex: 5 },
});
