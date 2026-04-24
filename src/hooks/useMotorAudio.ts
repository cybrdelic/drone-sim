import { useCallback, useEffect, useRef } from "react";
import { motorIndices, type MotorTuple } from "../sim/geometry/droneGeometry";
import { SimSettings, ViewMode } from "../types";

interface MotorAudioGraph {
  ctx: AudioContext;
  master: GainNode;
  motorOsc: MotorTuple<OscillatorNode>;
  motorGain: MotorTuple<GainNode>;
  noiseSrc: AudioBufferSourceNode;
  noiseGain: GainNode;
  noiseHp: BiquadFilterNode;
}

export interface MotorAudioTelemetry {
  omegaRad: MotorTuple<number>;
  omegaMaxRad: number;
  mechPowerW: number;
  thrustTotalN: number;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function createSeededNoiseBuffer(ctx: AudioContext, durationSec = 2) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * durationSec, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let state = 0x6d2b79f5;
  for (let index = 0; index < data.length; index++) {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    data[index] = ((((t ^ (t >>> 14)) >>> 0) / 4294967295) * 2) - 1;
  }
  return buffer;
}

function shutdownMotorAudioGraph(audio: MotorAudioGraph) {
  try {
    audio.master.gain.cancelScheduledValues(audio.ctx.currentTime);
    audio.master.gain.setValueAtTime(0.0001, audio.ctx.currentTime);
    audio.motorOsc.forEach((osc) => osc.stop());
    audio.noiseSrc.stop();
    void audio.ctx.close();
  } catch (error) {
    console.warn("Failed to tear down motor audio graph cleanly.", error);
  }
}

export function useMotorAudio(
  simSettings: SimSettings,
  viewMode: ViewMode,
) {
  const audioRef = useRef<MotorAudioGraph | null>(null);
  const audioTelemetry = useRef<MotorAudioTelemetry>({
    omegaRad: [0, 0, 0, 0],
    omegaMaxRad: 1,
    mechPowerW: 0,
    thrustTotalN: 0,
  });

  useEffect(() => {
    const AudioCtx =
      window.AudioContext ||
      (window as Window & typeof globalThis & {
        webkitAudioContext?: typeof AudioContext;
      }).webkitAudioContext;
    if (!AudioCtx) {
      return;
    }

    if (!simSettings.motorAudioEnabled) {
      const audio = audioRef.current;
      if (!audio) {
        return;
      }

      audio.master.gain.cancelScheduledValues(audio.ctx.currentTime);
      audio.master.gain.setTargetAtTime(0.0001, audio.ctx.currentTime, 0.02);
      void audio.ctx.suspend().catch((error) => {
        console.warn("Failed to suspend motor audio context.", error);
      });
      return;
    }

    if (!audioRef.current) {
      const ctx: AudioContext = new AudioCtx({ latencyHint: "interactive" });
      const master = ctx.createGain();
      master.gain.value = 0.0001;
      master.connect(ctx.destination);

      const motorOsc: OscillatorNode[] = [];
      const motorGain: GainNode[] = [];
      for (const _index of motorIndices) {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = 60;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        osc.connect(gain);
        gain.connect(master);
        osc.start();
        motorOsc.push(osc);
        motorGain.push(gain);
      }

      const noiseSrc = ctx.createBufferSource();
      noiseSrc.buffer = createSeededNoiseBuffer(ctx);
      noiseSrc.loop = true;

      const noiseHp = ctx.createBiquadFilter();
      noiseHp.type = "highpass";
      noiseHp.frequency.value = 400;
      noiseHp.Q.value = 0.7;

      const noiseGain = ctx.createGain();
      noiseGain.gain.value = 0;

      noiseSrc.connect(noiseHp);
      noiseHp.connect(noiseGain);
      noiseGain.connect(master);
      noiseSrc.start();

      audioRef.current = {
        ctx,
        master,
        motorOsc: motorOsc as MotorTuple<OscillatorNode>,
        motorGain: motorGain as MotorTuple<GainNode>,
        noiseSrc,
        noiseGain,
        noiseHp,
      };
    }

    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    void audio.ctx.resume().catch((error) => {
      console.warn("Motor audio remains muted until the browser allows playback.", error);
    });
  }, [simSettings.motorAudioEnabled]);

  useEffect(() => {
    return () => {
      if (!audioRef.current) {
        return;
      }
      shutdownMotorAudioGraph(audioRef.current);
      audioRef.current = null;
    };
  }, []);

  const updateMotorAudio = useCallback(() => {
    if (!audioRef.current) {
      return;
    }

    const nodes = audioRef.current;
    const telemetry = audioTelemetry.current;
    const enabled = simSettings.motorAudioEnabled && viewMode === "flight_sim";
    const masterTarget = enabled ? clamp01(simSettings.motorAudioVolume) : 0;
    nodes.master.gain.setTargetAtTime(
      Math.max(0.0001, masterTarget),
      nodes.ctx.currentTime,
      0.02,
    );

    const blades = 3;
    const omegaMax = Math.max(1e-3, telemetry.omegaMaxRad);
    for (const index of motorIndices) {
      const omega = Math.max(0, telemetry.omegaRad[index] ?? 0);
      const rps = omega / (2 * Math.PI);
      const bladePassFrequency = Math.max(0, rps * blades);
      nodes.motorOsc[index].frequency.setTargetAtTime(
        bladePassFrequency,
        nodes.ctx.currentTime,
        0.015,
      );

      const omegaNorm = clamp01(omega / omegaMax);
      const gain = enabled ? 0.08 * Math.pow(omegaNorm, 1.3) : 0;
      nodes.motorGain[index].gain.setTargetAtTime(
        gain,
        nodes.ctx.currentTime,
        0.02,
      );
    }

    const powerNorm = clamp01(
      Math.sqrt(Math.max(0, telemetry.mechPowerW)) / 80,
    );
    const noiseGain = enabled ? 0.05 * powerNorm : 0;
    nodes.noiseGain.gain.setTargetAtTime(
      noiseGain,
      nodes.ctx.currentTime,
      0.03,
    );
  }, [
    simSettings.motorAudioEnabled,
    simSettings.motorAudioVolume,
    viewMode,
  ]);

  return {
    audioTelemetry,
    updateMotorAudio,
  };
}
