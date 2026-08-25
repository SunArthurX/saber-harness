//! Version and compatibility primitives for the Saber local control protocol.

/// The first architecture-spike protocol version.
pub const PROTOCOL_VERSION: &str = "0.1.0";

/// Returns whether a peer protocol version is compatible with this skeleton.
#[must_use]
pub fn is_compatible(peer_version: &str) -> bool {
    peer_version == PROTOCOL_VERSION
}

#[cfg(test)]
mod tests {
    use super::{PROTOCOL_VERSION, is_compatible};

    #[test]
    fn exact_version_is_compatible() {
        assert!(is_compatible(PROTOCOL_VERSION));
    }

    #[test]
    fn unknown_version_fails_closed() {
        assert!(!is_compatible("999.0.0"));
    }
}
