// src/audio_processor.rs
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct AudioProcessor {
    current_bitrate: u32,
    min_bitrate: u32,
    max_bitrate: u32,
}

#[wasm_bindgen]
impl AudioProcessor {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        AudioProcessor {
            current_bitrate: 128000, // Start at 128 kbps
            min_bitrate: 8000,       // 8 kbps minimum
            max_bitrate: 128000,     // 128 kbps maximum
        }
    }

    pub fn adjust_bitrate(&mut self, target_bitrate: u32) -> u32 {
        // Add some smoothing to prevent abrupt changes
        let diff = (target_bitrate as i64 - self.current_bitrate as i64) as f64;
        let smoothed_target = self.current_bitrate as f64 + (diff * 0.1);

        // Convert to u32 and clamp to valid range
        self.current_bitrate =
            (smoothed_target.round() as u32).clamp(self.min_bitrate, self.max_bitrate);

        self.current_bitrate
    }
}
