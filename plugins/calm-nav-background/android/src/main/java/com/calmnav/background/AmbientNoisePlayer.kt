package com.calmnav.background

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import kotlin.random.Random

/**
 * The native ambient noise loop — a single generic, gently low-pass-filtered
 * noise bed via a streaming AudioTrack, not a port of ambientengine.js's 11
 * procedurally synthesized soundscapes (Web Audio API cannot run once the
 * WebView is backgrounded/throttled; see ANDROID_BACKGROUND_NAVIGATION.md's
 * "Known simplifications" for why *some* native fallback was still needed).
 * Ducks around TTS via NavEngine's onSpeakStart/onSpeakEnd callbacks,
 * restoring after a fixed 3s — matching iOS's fixed-duration approach for
 * directly comparable behavior across both platforms in this pass, since
 * TextToSpeech's own precise "done speaking" timing wasn't wired to a
 * variable-duration restore here.
 */
class AmbientNoisePlayer {
    private val sampleRate = 44100
    private var audioTrack: AudioTrack? = null
    private var playThread: Thread? = null
    @Volatile private var running = false
    @Volatile private var duckedGain = 1f

    fun start() {
        if (running) return
        val minBufferSize = AudioTrack.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val bufferSize = minBufferSize * 4

        audioTrack = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(sampleRate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            .setBufferSizeInBytes(bufferSize)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()

        running = true
        audioTrack?.play()
        playThread = Thread {
            // A simple one-pole low-pass filter over white noise — "generic
            // filtered noise", not a literal port of any specific soundscape.
            var lastSample = 0.0
            val alpha = 0.15
            val chunk = ShortArray(2048)
            while (running) {
                for (i in chunk.indices) {
                    val white = Random.nextDouble(-1.0, 1.0)
                    lastSample += alpha * (white - lastSample)
                    val amplitude = 0.18 * duckedGain
                    chunk[i] = (lastSample * amplitude * Short.MAX_VALUE).toInt().toShort()
                }
                audioTrack?.write(chunk, 0, chunk.size)
            }
        }
        playThread?.start()
    }

    fun stop() {
        running = false
        playThread?.join(500)
        playThread = null
        audioTrack?.stop()
        audioTrack?.release()
        audioTrack = null
    }

    fun duck() {
        duckedGain = 0.28f
    }

    fun restore() {
        duckedGain = 1f
    }
}
