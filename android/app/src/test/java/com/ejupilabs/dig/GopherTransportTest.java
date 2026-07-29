package com.ejupilabs.dig;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

import org.junit.Test;

public class GopherTransportTest {
    @Test
    public void fetchesRawBytesThroughThePinnedResolvedAddress() throws Exception {
        try (ServerSocket server = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
            CompletableFuture<String> requestLine = CompletableFuture.supplyAsync(() -> {
                try (Socket socket = server.accept()) {
                    BufferedReader reader = new BufferedReader(
                        new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8)
                    );
                    String line = reader.readLine();
                    socket.getOutputStream().write("hello\r\n.\r\n".getBytes(StandardCharsets.UTF_8));
                    socket.getOutputStream().flush();
                    return line;
                } catch (Exception error) {
                    throw new RuntimeException(error);
                }
            });

            GopherTransport transport = new GopherTransport(host ->
                new DestinationPolicy.Resolution(InetAddress.getLoopbackAddress(), 1)
            );
            GopherTransport.FetchResult result = transport.fetch(
                new GopherTransport.Request(
                    "fixture.invalid",
                    server.getLocalPort(),
                    "/hello",
                    "0",
                    null
                ),
                socket -> {}
            );

            assertEquals("/hello", requestLine.get(2, TimeUnit.SECONDS));
            assertArrayEquals(
                "hello\r\n.\r\n".getBytes(StandardCharsets.UTF_8),
                result.data
            );
            assertEquals(
                "b5b6d13987708f79b83af2c0dece3b7d13b2f8fe2694a6e646ba36b0d91b5ba5",
                result.sha256
            );
            assertEquals(4, result.family());
        }
    }

    @Test
    public void encodesSearchQueriesWithTheGopherTabDelimiter() throws Exception {
        GopherTransport.Request request = new GopherTransport.Request(
            "example.com",
            70,
            "/search",
            "7",
            "small web"
        );

        assertArrayEquals(
            "/search\tsmall web\r\n".getBytes(StandardCharsets.UTF_8),
            request.wireBytes()
        );
    }

    @Test
    public void rejectsInjectionAndOversizedRequests() {
        GopherTransport.Request injected = new GopherTransport.Request(
            "example.com",
            70,
            "/safe\r\n/second",
            "0",
            null
        );
        GopherException injectionError = assertThrows(
            GopherException.class,
            injected::validate
        );
        assertEquals("REQUEST_INVALID", injectionError.code());

        String oversizedSelector = "x".repeat(GopherTransport.MAX_REQUEST_BYTES);
        GopherTransport.Request oversized = new GopherTransport.Request(
            "example.com",
            70,
            oversizedSelector,
            "0",
            null
        );
        GopherException sizeError = assertThrows(
            GopherException.class,
            oversized::validate
        );
        assertEquals("REQUEST_TOO_LARGE", sizeError.code());
    }

    @Test
    public void rejectsEveryAsciiProtocolControlCharacter() {
        for (String value : new String[] { "\t", "\u001f", "\u007f" }) {
            GopherTransport.Request selectorRequest = new GopherTransport.Request(
                "example.com",
                70,
                "/safe" + value,
                "0",
                null
            );
            GopherException selectorError = assertThrows(
                GopherException.class,
                selectorRequest::validate
            );
            assertEquals("REQUEST_INVALID", selectorError.code());

            GopherTransport.Request queryRequest = new GopherTransport.Request(
                "example.com",
                70,
                "/search",
                "7",
                "query" + value
            );
            GopherException queryError = assertThrows(
                GopherException.class,
                queryRequest::validate
            );
            assertEquals("REQUEST_INVALID", queryError.code());
        }
    }

    @Test
    public void totalDeadlineIncludesDestinationResolution() {
        GopherTransport transport = new GopherTransport(host -> {
            try {
                Thread.sleep(5_000);
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
            }
            return new DestinationPolicy.Resolution(
                InetAddress.getLoopbackAddress(),
                1
            );
        }, 50);

        long startedAt = System.nanoTime();
        GopherException timeout = assertThrows(
            GopherException.class,
            () -> transport.fetch(
                new GopherTransport.Request(
                    "slow.invalid",
                    70,
                    "/",
                    "1",
                    null
                ),
                socket -> {}
            )
        );
        long elapsedMs = TimeUnit.NANOSECONDS.toMillis(
            System.nanoTime() - startedAt
        );

        assertEquals("UPSTREAM_TIMEOUT", timeout.code());
        assertTrue("Resolution timeout took too long", elapsedMs < 1_000);
    }
}
