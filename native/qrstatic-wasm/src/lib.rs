use std::alloc::{alloc, dealloc, Layout};
use std::slice;

use qrstatic::codec::temporal::TemporalDecodePolicy;
use qrstatic::codec::temporal_tiled::{TiledConfig, TiledDecoder, TiledEncoder, TiledStreamBlock};
use qrstatic::Grid;

const VIDEO_WIDTH: usize = 320;
const VIDEO_HEIGHT: usize = 240;
const FRAME_COUNT: usize = 64;
const QR_VERSION: u8 = 4;
const DATA_SHARDS: usize = 3;
const PARITY_SHARDS: usize = 1;
const NOISE_AMPLITUDE: f32 = 0.42;
const L1_AMPLITUDE: f32 = 0.22;
const DETECTOR_THRESHOLD: f32 = 6.0;

fn config() -> Result<TiledConfig, ()> {
    TiledConfig::new(
        (VIDEO_WIDTH, VIDEO_HEIGHT),
        QR_VERSION,
        FRAME_COUNT,
        NOISE_AMPLITUDE,
        L1_AMPLITUDE,
        DATA_SHARDS,
        PARITY_SHARDS,
    )
    .map_err(|_| ())
}

fn read_string(pointer: *const u8, length: usize) -> Result<String, ()> {
    let bytes = unsafe { slice::from_raw_parts(pointer, length) };
    String::from_utf8(bytes.to_vec()).map_err(|_| ())
}

fn read_bytes(pointer: *const u8, length: usize) -> Vec<u8> {
    unsafe { slice::from_raw_parts(pointer, length).to_vec() }
}

fn pack_result(pointer: *mut u8, length: usize) -> u64 {
    ((pointer as usize as u64) << 32) | length as u64
}

fn write_result(bytes: Vec<u8>) -> u64 {
    let length = bytes.len();
    let layout = Layout::array::<u8>(length.max(1)).expect("valid result layout");
    let pointer = unsafe { alloc(layout) };
    if pointer.is_null() {
        return 0;
    }
    unsafe { pointer.copy_from_nonoverlapping(bytes.as_ptr(), length) };
    pack_result(pointer, length)
}

#[unsafe(no_mangle)]
pub extern "C" fn qrstatic_frame_width() -> u32 {
    VIDEO_WIDTH as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn qrstatic_frame_height() -> u32 {
    VIDEO_HEIGHT as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn qrstatic_frame_count() -> u32 {
    FRAME_COUNT as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn qrstatic_max_payload_bytes() -> u32 {
    config()
        .ok()
        .and_then(|value| TiledEncoder::new(value, "capacity-probe").ok())
        .map(|encoder| encoder.layout().max_payload_bytes as u32)
        .unwrap_or(0)
}

#[unsafe(no_mangle)]
pub extern "C" fn qrstatic_alloc(length: usize) -> *mut u8 {
    let layout = Layout::array::<u8>(length.max(1)).expect("valid allocation layout");
    unsafe { alloc(layout) }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn qrstatic_free(pointer: *mut u8, length: usize) {
    if pointer.is_null() {
        return;
    }
    let layout = Layout::array::<u8>(length.max(1)).expect("valid allocation layout");
    unsafe { dealloc(pointer, layout) };
}

#[unsafe(no_mangle)]
pub extern "C" fn qrstatic_encode_block(
    key_pointer: *const u8,
    key_length: usize,
    payload_pointer: *const u8,
    payload_length: usize,
    session_id: u64,
    block_index: u32,
    block_count: u32,
) -> u64 {
    let Ok(key) = read_string(key_pointer, key_length) else {
        return 0;
    };
    let payload = read_bytes(payload_pointer, payload_length);
    let Ok(config) = config() else { return 0 };
    let Ok(encoder) = TiledEncoder::new(config, &key) else { return 0 };
    let Ok(block) = TiledStreamBlock::new(session_id, block_index, block_count, payload) else {
        return 0;
    };
    let Ok(frames) = encoder.encode_stream_block(&key, &block) else {
        return 0;
    };

    let mut output = Vec::with_capacity(FRAME_COUNT * VIDEO_WIDTH * VIDEO_HEIGHT * 4);
    for frame in frames {
        for value in frame.data() {
            output.extend_from_slice(&value.to_le_bytes());
        }
    }
    write_result(output)
}

#[unsafe(no_mangle)]
pub extern "C" fn qrstatic_decode_block(
    key_pointer: *const u8,
    key_length: usize,
    frames_pointer: *const u8,
    frames_length: usize,
) -> u64 {
    let Ok(key) = read_string(key_pointer, key_length) else {
        return 0;
    };
    let expected_length = FRAME_COUNT * VIDEO_WIDTH * VIDEO_HEIGHT * 4;
    if frames_length != expected_length {
        return 0;
    }

    let bytes = read_bytes(frames_pointer, frames_length);
    let mut frames = Vec::with_capacity(FRAME_COUNT);
    for frame_index in 0..FRAME_COUNT {
        let start = frame_index * VIDEO_WIDTH * VIDEO_HEIGHT * 4;
        let values = bytes[start..start + VIDEO_WIDTH * VIDEO_HEIGHT * 4]
            .chunks_exact(4)
            .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
            .collect::<Vec<_>>();
        frames.push(Grid::from_vec(values, VIDEO_WIDTH, VIDEO_HEIGHT));
    }

    let Ok(config) = config() else { return 0 };
    let Ok(decoder) = TiledDecoder::new(config, &key) else { return 0 };
    let Ok(policy) = TemporalDecodePolicy::fixed_threshold(DETECTOR_THRESHOLD) else { return 0 };
    let Ok(result) = decoder.decode_payload(&frames, &key, &policy) else { return 0 };
    let Some(block) = result.stream_block else { return 0 };
    let Ok(encoded) = block.encode() else { return 0 };
    write_result(encoded)
}

// The tests below are the evidence behind docs/qrstatic-notes.md. QRStatic
// scatters every cell through a different keyed permutation on every frame, so
// the decoder needs the exact pixel grid and the exact frame order it encoded.
// The perturbation tests measure what a camera would do to that grid.
#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "optical-transfer-demo qrstatic v1";

    fn sample_block() -> TiledStreamBlock {
        TiledStreamBlock::new(42, 0, 1, b"native QRStatic wrapper smoke test".to_vec())
            .expect("test block must be valid")
    }

    fn encode(block: &TiledStreamBlock) -> Vec<Grid<f32>> {
        TiledEncoder::new(config().expect("configuration must be valid"), KEY)
            .expect("the configured encoder must initialize")
            .encode_stream_block(KEY, block)
            .expect("the configured encoder must produce a full window")
    }

    fn decode(frames: &[Grid<f32>]) -> Option<TiledStreamBlock> {
        let policy =
            TemporalDecodePolicy::fixed_threshold(DETECTOR_THRESHOLD).expect("threshold must be valid");
        TiledDecoder::new(config().expect("configuration must be valid"), KEY)
            .expect("the configured decoder must initialize")
            .decode_payload(frames, KEY, &policy)
            .ok()
            .and_then(|result| result.stream_block)
    }

    fn map_frames(frames: &[Grid<f32>], sample: impl Fn(&Grid<f32>, usize, usize) -> f32) -> Vec<Grid<f32>> {
        frames
            .iter()
            .map(|frame| {
                let mut values = Vec::with_capacity(VIDEO_WIDTH * VIDEO_HEIGHT);
                for y in 0..VIDEO_HEIGHT {
                    for x in 0..VIDEO_WIDTH {
                        values.push(sample(frame, x, y));
                    }
                }
                Grid::from_vec(values, VIDEO_WIDTH, VIDEO_HEIGHT)
            })
            .collect()
    }

    fn at(frame: &Grid<f32>, x: usize, y: usize) -> f32 {
        frame.data()[y.min(VIDEO_HEIGHT - 1) * VIDEO_WIDTH + x.min(VIDEO_WIDTH - 1)]
    }

    #[test]
    fn configured_temporal_window_round_trips() {
        let block = sample_block();
        assert_eq!(decode(&encode(&block)), Some(block));
    }

    #[test]
    fn one_pixel_of_spatial_drift_defeats_the_decoder() {
        let frames = encode(&sample_block());
        let shifted = map_frames(&frames, |frame, x, y| at(frame, x + 1, y));

        assert_eq!(decode(&shifted), None, "a camera cannot hold the grid to the pixel");
    }

    #[test]
    fn one_frame_of_temporal_drift_defeats_the_decoder() {
        let frames = encode(&sample_block());
        let mut rotated = frames[1..].to_vec();
        rotated.push(frames[0].clone());

        assert_eq!(decode(&rotated), None, "a camera cannot know which frame is index zero");
    }

    #[test]
    fn mild_optical_blur_defeats_the_decoder() {
        let frames = encode(&sample_block());
        let blurred = map_frames(&frames, |frame, x, y| {
            let mut total = 0.0;
            for dy in 0..3 {
                for dx in 0..3 {
                    total += at(frame, (x + dx).saturating_sub(1), (y + dy).saturating_sub(1));
                }
            }
            total / 9.0
        });

        assert_eq!(decode(&blurred), None, "neighbouring cells carry unrelated permutations");
    }
}
