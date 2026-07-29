package com.ejupilabs.dig;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.FutureTask;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;

final class GopherTransport {
    private static final String REQUESTABLE_TYPES = "+01345679IPdgs";
    static final int MAX_REQUEST_BYTES = 8_192;
    static final int MAX_RESPONSE_BYTES = 1_048_576;
    static final int TOTAL_TIMEOUT_MS = 10_000;
    static final int IDLE_TIMEOUT_MS = 2_000;
    private static final int MAX_CONCURRENT_RESOLUTIONS = 4;
    private static final ThreadPoolExecutor RESOLVER_EXECUTOR =
        new ThreadPoolExecutor(
            0,
            MAX_CONCURRENT_RESOLUTIONS,
            30,
            TimeUnit.SECONDS,
            new SynchronousQueue<>(),
            new ResolverThreadFactory(),
            new ThreadPoolExecutor.AbortPolicy()
        );

    interface Resolver {
        DestinationPolicy.Resolution resolve(String host) throws GopherException;
    }

    private final Resolver resolver;
    private final int totalTimeoutMs;

    GopherTransport(Resolver resolver) {
        this(resolver, TOTAL_TIMEOUT_MS);
    }

    GopherTransport(Resolver resolver, int totalTimeoutMs) {
        if (resolver == null || totalTimeoutMs < 1) {
            throw new IllegalArgumentException("A resolver and positive timeout are required.");
        }
        this.resolver = resolver;
        this.totalTimeoutMs = totalTimeoutMs;
    }

    FetchResult fetch(Request request, Consumer<Socket> socketConsumer)
        throws GopherException {
        request.validate();
        if (Thread.currentThread().isInterrupted()) throw aborted();
        long startedAt = System.nanoTime();
        long deadline = startedAt + (totalTimeoutMs * 1_000_000L);
        DestinationPolicy.Resolution resolution = resolve(request.host, deadline);
        if (Thread.currentThread().isInterrupted()) throw aborted();
        InetAddress address = resolution.address();
        byte[] wireRequest = request.wireBytes();

        try (Socket socket = new Socket()) {
            socketConsumer.accept(socket);
            socket.connect(
                new InetSocketAddress(address, request.port),
                remainingMillis(deadline)
            );
            socket.setSoTimeout(Math.min(IDLE_TIMEOUT_MS, remainingMillis(deadline)));
            OutputStream output = socket.getOutputStream();
            output.write(wireRequest);
            output.flush();

            ByteArrayOutputStream payload = new ByteArrayOutputStream();
            InputStream input = socket.getInputStream();
            byte[] chunk = new byte[16_384];
            while (true) {
                if (Thread.currentThread().isInterrupted()) throw aborted();
                int remaining = remainingMillis(deadline);
                socket.setSoTimeout(Math.min(IDLE_TIMEOUT_MS, remaining));
                int read;
                try {
                    read = input.read(chunk);
                } catch (SocketTimeoutException error) {
                    if (System.nanoTime() >= deadline) {
                        throw new GopherException(
                            "UPSTREAM_TIMEOUT",
                            "The Gopher request exceeded its total deadline."
                        );
                    }
                    throw new GopherException(
                        "UPSTREAM_IDLE_TIMEOUT",
                        "The Gopher server stopped responding."
                    );
                }
                if (read == -1) break;
                if (payload.size() + read > MAX_RESPONSE_BYTES) {
                    throw new GopherException(
                        "RESPONSE_TOO_LARGE",
                        "The Gopher response exceeded the 1 MiB limit."
                    );
                }
                payload.write(chunk, 0, read);
            }

            byte[] bytes = payload.toByteArray();
            double durationMs =
                Math.round(((System.nanoTime() - startedAt) / 100_000.0)) / 10.0;
            return new FetchResult(
                bytes,
                sha256(bytes),
                durationMs,
                address,
                resolution.resolvedCount()
            );
        } catch (GopherException error) {
            throw error;
        } catch (SocketTimeoutException error) {
            throw new GopherException(
                "UPSTREAM_TIMEOUT",
                "DIG could not connect before the request deadline."
            );
        } catch (SocketException error) {
            if (Thread.currentThread().isInterrupted()) throw aborted();
            throw new GopherException(
                "UPSTREAM_CONNECTION_FAILED",
                "The Gopher connection closed unexpectedly."
            );
        } catch (IOException error) {
            if (Thread.currentThread().isInterrupted()) throw aborted();
            throw new GopherException(
                "UPSTREAM_CONNECTION_FAILED",
                "DIG could not complete the Gopher request."
            );
        } finally {
            socketConsumer.accept(null);
        }
    }

    private DestinationPolicy.Resolution resolve(String host, long deadline)
        throws GopherException {
        FutureTask<DestinationPolicy.Resolution> resolutionTask =
            new FutureTask<>(() -> resolver.resolve(host));
        try {
            RESOLVER_EXECUTOR.execute(resolutionTask);
        } catch (RejectedExecutionException error) {
            throw new GopherException(
                "DESTINATION_RESOLUTION_BUSY",
                "DIG is already resolving the maximum number of destinations."
            );
        }
        try {
            return resolutionTask.get(remainingMillis(deadline), TimeUnit.MILLISECONDS);
        } catch (TimeoutException error) {
            resolutionTask.cancel(true);
            throw new GopherException(
                "UPSTREAM_TIMEOUT",
                "Destination resolution exceeded the request deadline."
            );
        } catch (InterruptedException error) {
            resolutionTask.cancel(true);
            Thread.currentThread().interrupt();
            throw aborted();
        } catch (ExecutionException error) {
            Throwable cause = error.getCause();
            if (cause instanceof GopherException) {
                throw (GopherException) cause;
            }
            throw new GopherException(
                "DESTINATION_RESOLUTION_FAILED",
                "The destination could not be resolved."
            );
        }
    }

    private static int remainingMillis(long deadline) throws GopherException {
        long remainingNanos = deadline - System.nanoTime();
        if (remainingNanos <= 0) {
            throw new GopherException(
                "UPSTREAM_TIMEOUT",
                "The Gopher request exceeded its total deadline."
            );
        }
        return (int) Math.max(1, Math.min(
            Integer.MAX_VALUE,
            (remainingNanos + 999_999L) / 1_000_000L
        ));
    }

    private static String sha256(byte[] value) throws GopherException {
        final MessageDigest digest;
        try {
            digest = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException error) {
            throw new GopherException(
                "CRYPTO_UNAVAILABLE",
                "SHA-256 is unavailable on this device."
            );
        }
        StringBuilder output = new StringBuilder(64);
        for (byte part : digest.digest(value)) {
            output.append(String.format(Locale.ROOT, "%02x", part & 0xff));
        }
        return output.toString();
    }

    private static GopherException aborted() {
        return new GopherException("REQUEST_ABORTED", "The request was cancelled.");
    }

    static final class Request {
        final String host;
        final int port;
        final String selector;
        final String itemType;
        final String query;

        Request(String host, int port, String selector, String itemType, String query) {
            this.host = host;
            this.port = port;
            this.selector = selector;
            this.itemType = itemType;
            this.query = query;
        }

        void validate() throws GopherException {
            if (
                host == null ||
                host.trim().isEmpty() ||
                host.length() > 253 ||
                hasProtocolControl(host) ||
                hasWhitespace(host) ||
                port < 1 ||
                port > 65_535 ||
                selector == null ||
                itemType == null ||
                itemType.length() != 1 ||
                REQUESTABLE_TYPES.indexOf(itemType) < 0 ||
                hasProtocolControl(selector) ||
                (query != null && hasProtocolControl(query)) ||
                ("7".equals(itemType) && (query == null || query.isEmpty())) ||
                (!"7".equals(itemType) && query != null)
            ) {
                throw new GopherException(
                    "REQUEST_INVALID",
                    "The Gopher request is invalid."
                );
            }
            wireBytes();
        }

        byte[] wireBytes() throws GopherException {
            String request = selector +
                (query == null ? "" : "\t" + query) +
                "\r\n";
            byte[] bytes = request.getBytes(StandardCharsets.UTF_8);
            if (bytes.length > MAX_REQUEST_BYTES) {
                throw new GopherException(
                    "REQUEST_TOO_LARGE",
                    "The Gopher request exceeded the 8 KiB limit."
                );
            }
            return bytes;
        }

        private static boolean hasProtocolControl(String value) {
            for (int index = 0; index < value.length(); index += 1) {
                char character = value.charAt(index);
                if (character <= 0x1f || character == 0x7f) return true;
            }
            return false;
        }

        private static boolean hasWhitespace(String value) {
            for (int index = 0; index < value.length(); index += 1) {
                if (Character.isWhitespace(value.charAt(index))) return true;
            }
            return false;
        }
    }

    private static final class ResolverThreadFactory implements ThreadFactory {
        private final AtomicInteger counter = new AtomicInteger();

        @Override
        public Thread newThread(Runnable runnable) {
            Thread thread = new Thread(
                runnable,
                "dig-resolver-" + counter.incrementAndGet()
            );
            thread.setDaemon(true);
            return thread;
        }
    }

    static final class FetchResult {
        final byte[] data;
        final String sha256;
        final double durationMs;
        final InetAddress address;
        final int resolvedCount;

        FetchResult(
            byte[] data,
            String sha256,
            double durationMs,
            InetAddress address,
            int resolvedCount
        ) {
            this.data = data;
            this.sha256 = sha256;
            this.durationMs = durationMs;
            this.address = address;
            this.resolvedCount = resolvedCount;
        }

        int family() {
            return address instanceof Inet4Address ? 4 : 6;
        }
    }
}
