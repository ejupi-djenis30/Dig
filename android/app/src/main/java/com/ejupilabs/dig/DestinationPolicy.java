package com.ejupilabs.dig;

import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.UnknownHostException;

final class DestinationPolicy {
    private static final int[][] IPV4_BLOCKS = {
        { 0x00000000, 8 },
        { 0x0a000000, 8 },
        { 0x64400000, 10 },
        { 0x7f000000, 8 },
        { 0xa9fe0000, 16 },
        { 0xac100000, 12 },
        { 0xc0000000, 24 },
        { 0xc0000200, 24 },
        { 0xc0586300, 24 },
        { 0xc0a80000, 16 },
        { 0xc6120000, 15 },
        { 0xc6336400, 24 },
        { 0xcb007100, 24 },
        { 0xe0000000, 4 },
        { 0xf0000000, 4 },
    };

    private static final byte[][] IPV6_SPECIAL_PREFIXES = {
        bytes(0x20, 0x01, 0x00, 0x00),
        bytes(0x20, 0x01, 0x00, 0x02, 0x00, 0x00),
        bytes(0x20, 0x01, 0x00, 0x10),
        bytes(0x20, 0x01, 0x00, 0x20),
        bytes(0x20, 0x01, 0x0d, 0xb8),
        bytes(0x20, 0x02),
        bytes(0x3f, 0xff, 0x00),
    };

    private static final int[] IPV6_SPECIAL_LENGTHS = {
        32, 48, 28, 28, 32, 16, 20,
    };

    private DestinationPolicy() {}

    static Resolution resolvePublic(String host) throws GopherException {
        final InetAddress[] addresses;
        try {
            addresses = InetAddress.getAllByName(host);
        } catch (UnknownHostException error) {
            throw new GopherException(
                "DESTINATION_RESOLUTION_FAILED",
                "The destination could not be resolved."
            );
        }
        if (addresses.length == 0) {
            throw new GopherException(
                "DESTINATION_RESOLUTION_FAILED",
                "The destination could not be resolved."
            );
        }
        for (InetAddress address : addresses) {
            if (!isPublic(address)) {
                throw new GopherException(
                    "DESTINATION_BLOCKED",
                    "The destination resolved to an address that DIG blocks."
                );
            }
        }
        return new Resolution(addresses[0], addresses.length);
    }

    static boolean isPublic(InetAddress address) {
        byte[] value = address.getAddress();
        if (address instanceof Inet4Address || value.length == 4) {
            return isPublicIpv4(value);
        }
        if (!(address instanceof Inet6Address) || value.length != 16) {
            return false;
        }

        if (isIpv4Mapped(value)) {
            return isPublicIpv4(new byte[] {
                value[12], value[13], value[14], value[15],
            });
        }
        if (allZero(value) || isLoopback(value)) return false;
        if ((unsigned(value[0]) & 0xfe) == 0xfc) return false;
        if (unsigned(value[0]) == 0xfe && (unsigned(value[1]) & 0xc0) == 0x80) {
            return false;
        }
        if (unsigned(value[0]) == 0xff) return false;

        for (int index = 0; index < IPV6_SPECIAL_PREFIXES.length; index += 1) {
            if (
                hasPrefix(
                    value,
                    IPV6_SPECIAL_PREFIXES[index],
                    IPV6_SPECIAL_LENGTHS[index]
                )
            ) {
                return false;
            }
        }
        return (unsigned(value[0]) & 0xe0) == 0x20;
    }

    private static boolean isPublicIpv4(byte[] value) {
        int candidate =
            (unsigned(value[0]) << 24) |
            (unsigned(value[1]) << 16) |
            (unsigned(value[2]) << 8) |
            unsigned(value[3]);
        for (int[] block : IPV4_BLOCKS) {
            int prefixLength = block[1];
            int mask = prefixLength == 0 ? 0 : (int) (0xffffffffL << (32 - prefixLength));
            if ((candidate & mask) == (block[0] & mask)) return false;
        }
        return true;
    }

    private static boolean isIpv4Mapped(byte[] value) {
        for (int index = 0; index < 10; index += 1) {
            if (value[index] != 0) return false;
        }
        return unsigned(value[10]) == 0xff && unsigned(value[11]) == 0xff;
    }

    private static boolean allZero(byte[] value) {
        for (byte part : value) {
            if (part != 0) return false;
        }
        return true;
    }

    private static boolean isLoopback(byte[] value) {
        for (int index = 0; index < 15; index += 1) {
            if (value[index] != 0) return false;
        }
        return value[15] == 1;
    }

    private static boolean hasPrefix(byte[] value, byte[] prefix, int bits) {
        int completeBytes = bits / 8;
        int remainingBits = bits % 8;
        for (int index = 0; index < completeBytes; index += 1) {
            if (value[index] != prefix[index]) return false;
        }
        if (remainingBits == 0) return true;
        int mask = 0xff << (8 - remainingBits);
        return (unsigned(value[completeBytes]) & mask) ==
            (unsigned(prefix[completeBytes]) & mask);
    }

    private static int unsigned(byte value) {
        return value & 0xff;
    }

    private static byte[] bytes(int... values) {
        byte[] result = new byte[values.length];
        for (int index = 0; index < values.length; index += 1) {
            result[index] = (byte) values[index];
        }
        return result;
    }

    static final class Resolution {
        private final InetAddress address;
        private final int resolvedCount;

        Resolution(InetAddress address, int resolvedCount) {
            this.address = address;
            this.resolvedCount = resolvedCount;
        }

        InetAddress address() {
            return address;
        }

        int resolvedCount() {
            return resolvedCount;
        }
    }
}
