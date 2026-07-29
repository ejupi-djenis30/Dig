package com.ejupilabs.dig;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.net.InetAddress;

import org.junit.Test;

public class DestinationPolicyTest {
    @Test
    public void blocksEveryNonPublicIpv4Class() throws Exception {
        for (String address : new String[] {
            "0.1.2.3",
            "10.0.0.1",
            "100.64.0.1",
            "127.0.0.1",
            "169.254.1.1",
            "172.16.0.1",
            "192.0.0.1",
            "192.0.2.1",
            "192.168.1.1",
            "198.18.0.1",
            "198.51.100.1",
            "203.0.113.1",
            "224.0.0.1",
            "255.255.255.255",
        }) {
            assertFalse(address, DestinationPolicy.isPublic(InetAddress.getByName(address)));
        }
        assertTrue(DestinationPolicy.isPublic(InetAddress.getByName("8.8.8.8")));
    }

    @Test
    public void blocksLocalSpecialAndDocumentationIpv6() throws Exception {
        for (String address : new String[] {
            "::",
            "::1",
            "fc00::1",
            "fe80::1",
            "ff02::1",
            "2001::1",
            "2001:2::1",
            "2001:10::1",
            "2001:20::1",
            "2001:db8::1",
            "2002::1",
            "3fff::1",
        }) {
            assertFalse(address, DestinationPolicy.isPublic(InetAddress.getByName(address)));
        }
        assertTrue(
            DestinationPolicy.isPublic(
                InetAddress.getByName("2606:4700:4700::1111")
            )
        );
    }
}
