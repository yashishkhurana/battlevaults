import { encodePacked, keccak256, type Hex } from "viem";

/**
 * Packs sanitized address arguments exactly like abi.encodePacked(addr, addr, ...) on-chain,
 * which is what each DecoderAndSanitizer returns. Empty -> "0x".
 */
export function packAddresses(addresses: Hex[]): Hex {
  if (addresses.length === 0) return "0x";
  return encodePacked(
    addresses.map(() => "address"),
    addresses,
  );
}

/**
 * leaf = keccak256(abi.encodePacked(decoder, target, valueNonZero, selector, packedArgs))
 *
 * MUST stay byte-for-byte identical to ManagerWithMerkleVerification._verifyCall:
 *   - decoder      : address (20 bytes)
 *   - target       : address (20 bytes)
 *   - valueNonZero : bool    (1 byte)
 *   - selector     : bytes4  (4 bytes)
 *   - packedArgs   : bytes   (raw, no length prefix)
 */
export function makeLeaf(params: {
  decoder: Hex;
  target: Hex;
  valueNonZero: boolean;
  selector: Hex; // bytes4
  packedArgs: Hex; // from packAddresses()
}): Hex {
  return keccak256(
    encodePacked(
      ["address", "address", "bool", "bytes4", "bytes"],
      [params.decoder, params.target, params.valueNonZero, params.selector, params.packedArgs],
    ),
  );
}
