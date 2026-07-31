//! Answers one question with numbers: can the QRStatic temporal codec survive a
//! camera if the sender slows down, or puts less data in each frame, or draws
//! the pattern larger?
//!
//! These use the plain temporal codec, where one cell of the frame is one QR
//! module. That is the same signal model as the tiled transport this crate
//! ships, without the tiled layout's minimum sizes, so the mechanism is easier
//! to see.
//!
//! The simulation is deliberately generous to the camera: perfect exposure, no
//! rotation, no rolling shutter, no sensor noise, and a receiver that already
//! knows which captured frame is index zero.

use qrstatic::codec::temporal::{TemporalConfig, TemporalDecodePolicy, TemporalDecoder, TemporalEncoder};
use qrstatic::Grid;

const FRAME_COUNT: usize = 64;
const NOISE_AMPLITUDE: f32 = 0.42;
const L1_AMPLITUDE: f32 = 0.22;
const DETECTOR_THRESHOLD: f32 = 6.0;
const KEY: &str = "camera-path-probe";
const SIDE: usize = 41;
const MESSAGE: &str = "camera path probe";

fn config() -> TemporalConfig {
    TemporalConfig::new((SIDE, SIDE), FRAME_COUNT, NOISE_AMPLITUDE, L1_AMPLITUDE).expect("valid configuration")
}

fn encode() -> Vec<Grid<f32>> {
    TemporalEncoder::new(config())
        .expect("encoder")
        .encode_message(KEY, MESSAGE)
        .expect("window")
}

fn decodes(frames: &[Grid<f32>]) -> bool {
    let policy = TemporalDecodePolicy::fixed_threshold(DETECTOR_THRESHOLD).expect("policy");
    TemporalDecoder::new(config())
        .expect("decoder")
        .decode_qr(frames, KEY, &policy)
        .ok()
        .and_then(|result| result.message)
        .is_some_and(|message| message == MESSAGE)
}

fn sample(frame: &Grid<f32>, x: isize, y: isize) -> f32 {
    let cx = x.clamp(0, SIDE as isize - 1) as usize;
    let cy = y.clamp(0, SIDE as isize - 1) as usize;
    frame.data()[cy * SIDE + cx]
}

fn map(frames: &[Grid<f32>], sample_at: impl Fn(&Grid<f32>, isize, isize) -> f32) -> Vec<Grid<f32>> {
    frames
        .iter()
        .map(|frame| {
            let mut values = Vec::with_capacity(SIDE * SIDE);
            for y in 0..SIDE as isize {
                for x in 0..SIDE as isize {
                    values.push(sample_at(frame, x, y));
                }
            }
            Grid::from_vec(values, SIDE, SIDE)
        })
        .collect()
}

/// A lens blurs by a fixed number of screen pixels. How far that reaches in
/// cells depends on how many screen pixels the sender gives each cell.
fn through_a_lens(frames: &[Grid<f32>], screen_pixels_per_cell: usize) -> Vec<Grid<f32>> {
    let reach: isize = if screen_pixels_per_cell > 1 { 0 } else { 1 };
    map(frames, |frame, x, y| {
        let mut total = 0.0;
        let mut count = 0.0;
        for dy in -reach..=reach {
            for dx in -reach..=reach {
                total += sample(frame, x + dx, y + dy);
                count += 1.0;
            }
        }
        total / count
    })
}

#[test]
fn the_clean_window_decodes() {
    assert!(decodes(&encode()), "the encoder and decoder must agree before anything is perturbed");
}

#[test]
fn one_screen_pixel_per_cell_does_not_survive_a_lens() {
    assert!(!decodes(&through_a_lens(&encode(), 1)), "blur across cells destroys the correlation");
}

#[test]
fn drawing_each_cell_larger_is_what_survives_the_lens() {
    // The same window, the same payload, the same frame rate. The only change
    // is that the sender gives each cell several screen pixels, so the blur
    // stays inside a cell instead of mixing cells that carry unrelated
    // permutations. This is the one lever that helps.
    assert!(decodes(&through_a_lens(&encode(), 4)), "large cells keep the blur inside a cell");
}

#[test]
fn large_cells_still_need_exact_registration() {
    // One cell of drift, which is what a hand-held camera leaves behind without
    // fiducials and a homography. Slowing the sender down does not touch this.
    let shifted = map(&encode(), |frame, x, y| sample(frame, x + 1, y));

    assert!(!decodes(&shifted), "one cell of drift still defeats the decoder");
}

#[test]
fn large_cells_still_need_exact_frame_order() {
    // The receiver must know which captured frame is index zero and must drop
    // none of the 64. A slower sender makes this easier to arrange but does not
    // supply it: nothing in the format marks a frame index.
    let frames = encode();
    let mut rotated = frames[1..].to_vec();
    rotated.push(frames[0].clone());

    assert!(!decodes(&rotated), "a one frame offset still defeats the decoder");
}
