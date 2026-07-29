package com.ejupilabs.dig;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;
import java.net.Socket;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.FutureTask;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

@CapacitorPlugin(name = "DigGopher")
public final class DigGopherPlugin extends Plugin {
    private static final int MAX_CONCURRENT_REQUESTS = 4;
    private static final int MAX_QUEUED_REQUESTS = 16;

    private final Map<String, RequestHandle> requests = new ConcurrentHashMap<>();
    private final Map<String, Socket> sockets = new ConcurrentHashMap<>();
    private final GopherTransport transport =
        new GopherTransport(DestinationPolicy::resolvePublic);
    private final ThreadPoolExecutor executor = new ThreadPoolExecutor(
        2,
        MAX_CONCURRENT_REQUESTS,
        30,
        TimeUnit.SECONDS,
        new ArrayBlockingQueue<>(MAX_QUEUED_REQUESTS),
        new NamedThreadFactory(),
        new ThreadPoolExecutor.AbortPolicy()
    );

    @PluginMethod
    public void getConfig(PluginCall call) {
        JSObject limits = new JSObject();
        limits.put("requestBytes", GopherTransport.MAX_REQUEST_BYTES);
        limits.put("responseBytes", GopherTransport.MAX_RESPONSE_BYTES);
        limits.put("timeoutMs", GopherTransport.TOTAL_TIMEOUT_MS);
        limits.put("idleTimeoutMs", GopherTransport.IDLE_TIMEOUT_MS);

        JSObject config = new JSObject();
        config.put("schemaVersion", 1);
        config.put("mode", "android");
        config.put("requiresAccessToken", false);
        config.put("allowPrivate", false);
        config.put(
            "privateDestinationWarning",
            "Private, loopback, link-local and reserved destinations are blocked."
        );
        config.put("limits", limits);
        config.put("homeAddress", "gopher://gopher.floodgap.com/1/");
        config.put("version", BuildConfig.VERSION_NAME);
        call.resolve(config);
    }

    @PluginMethod
    public void fetch(PluginCall call) {
        String requestId = call.getString("requestId");
        String host = call.getString("host");
        Integer port = call.getInt("port");
        String selector = call.getString("selector");
        String itemType = call.getString("itemType");
        String query = call.getString("query");

        if (
            requestId == null ||
            !requestId.matches("[A-Za-z0-9-]{1,64}") ||
            port == null
        ) {
            call.reject("The Android request is invalid.", "REQUEST_INVALID");
            return;
        }

        GopherTransport.Request request = new GopherTransport.Request(
            host,
            port,
            selector,
            itemType,
            query
        );
        RequestHandle handle = new RequestHandle(call);
        FutureTask<Void> task = new FutureTask<>(() -> {
            try {
                GopherTransport.FetchResult result = transport.fetch(
                    request,
                    socket -> {
                        if (socket == null) {
                            sockets.remove(requestId);
                        } else if (requests.get(requestId) != handle) {
                            closeQuietly(socket);
                        } else {
                            sockets.put(requestId, socket);
                            if (
                                requests.get(requestId) != handle &&
                                sockets.remove(requestId, socket)
                            ) {
                                closeQuietly(socket);
                            }
                        }
                    }
                );
                JSObject connection = new JSObject();
                connection.put("family", result.family());
                connection.put("address", result.address.getHostAddress());
                connection.put("policy", "public");
                connection.put("resolvedCount", result.resolvedCount);

                JSObject response = new JSObject();
                response.put(
                    "data",
                    Base64.encodeToString(result.data, Base64.NO_WRAP)
                );
                response.put("byteLength", result.data.length);
                response.put("sha256", result.sha256);
                response.put("durationMs", result.durationMs);
                response.put("connection", connection);
                handle.resolve(response);
            } catch (GopherException error) {
                handle.reject(error.getMessage(), error.code());
            } catch (RuntimeException error) {
                handle.reject(
                    "The Android transport failed safely.",
                    "NATIVE_TRANSPORT_FAILED"
                );
            } finally {
                requests.remove(requestId, handle);
                sockets.remove(requestId);
            }
            return null;
        });
        handle.attach(task);

        if (requests.putIfAbsent(requestId, handle) != null) {
            call.reject("The request identifier is already active.", "REQUEST_CONFLICT");
            return;
        }
        try {
            executor.execute(task);
        } catch (RuntimeException error) {
            requests.remove(requestId, handle);
            handle.reject(
                "DIG is already handling the maximum number of requests.",
                "TOO_MANY_REQUESTS"
            );
        }
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String requestId = call.getString("requestId");
        if (
            requestId == null ||
            !requestId.matches("[A-Za-z0-9-]{1,64}")
        ) {
            call.reject("The request identifier is invalid.", "REQUEST_INVALID");
            return;
        }
        closeSocket(requestId);
        RequestHandle handle = requests.remove(requestId);
        if (handle != null) handle.cancel();
        call.resolve();
    }

    @PluginMethod
    public void save(PluginCall call) {
        String data = call.getString("data");
        String suggestedFilename = call.getString(
            "suggestedFilename",
            "gopher-resource.bin"
        );
        String mediaType = call.getString(
            "mediaType",
            "application/octet-stream"
        );
        if (
            data == null ||
            data.length() > ((GopherTransport.MAX_RESPONSE_BYTES * 4 / 3) + 8) ||
            suggestedFilename == null ||
            !suggestedFilename.matches("[A-Za-z0-9._-]{1,120}") ||
            mediaType == null ||
            !mediaType.matches("[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+")
        ) {
            call.reject("The file metadata is invalid.", "SAVE_INVALID");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mediaType);
        intent.putExtra(Intent.EXTRA_TITLE, suggestedFilename);
        startActivityForResult(call, intent, "saveResult");
    }

    @ActivityCallback
    private void saveResult(PluginCall call, ActivityResult activityResult) {
        if (call == null) return;
        if (activityResult.getResultCode() != Activity.RESULT_OK) {
            JSObject result = new JSObject();
            result.put("saved", false);
            call.resolve(result);
            return;
        }
        Intent resultData = activityResult.getData();
        Uri destination = resultData == null ? null : resultData.getData();
        if (destination == null) {
            call.reject("Android did not return a file destination.", "SAVE_FAILED");
            return;
        }

        try {
            byte[] bytes = Base64.decode(call.getString("data"), Base64.DEFAULT);
            if (bytes.length > GopherTransport.MAX_RESPONSE_BYTES) {
                call.reject("The file exceeded the 1 MiB limit.", "SAVE_INVALID");
                return;
            }
            try (
                OutputStream output = getContext()
                    .getContentResolver()
                    .openOutputStream(destination, "w")
            ) {
                if (output == null) {
                    call.reject("Android could not open the selected file.", "SAVE_FAILED");
                    return;
                }
                output.write(bytes);
                output.flush();
            }
            JSObject result = new JSObject();
            result.put("saved", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("DIG could not save the selected file.", "SAVE_FAILED");
        }
    }

    @Override
    protected void handleOnDestroy() {
        for (Map.Entry<String, RequestHandle> request : requests.entrySet()) {
            if (requests.remove(request.getKey(), request.getValue())) {
                closeSocket(request.getKey());
                request.getValue().cancel();
            }
        }
        executor.shutdownNow();
    }

    private static final class RequestHandle {
        private final PluginCall call;
        private final AtomicBoolean settled = new AtomicBoolean();
        private volatile FutureTask<Void> task;

        RequestHandle(PluginCall call) {
            this.call = call;
        }

        void attach(FutureTask<Void> task) {
            this.task = task;
        }

        void resolve(JSObject response) {
            if (settled.compareAndSet(false, true)) call.resolve(response);
        }

        void reject(String message, String code) {
            if (settled.compareAndSet(false, true)) call.reject(message, code);
        }

        void cancel() {
            reject("The request was cancelled.", "REQUEST_ABORTED");
            FutureTask<Void> activeTask = task;
            if (activeTask != null) activeTask.cancel(true);
        }
    }

    private void closeSocket(String requestId) {
        Socket socket = sockets.remove(requestId);
        if (socket == null) return;
        closeQuietly(socket);
    }

    private static void closeQuietly(Socket socket) {
        try {
            socket.close();
        } catch (Exception ignored) {
            // Cancellation is best-effort and never leaks socket details.
        }
    }

    private static final class NamedThreadFactory implements ThreadFactory {
        private final AtomicInteger counter = new AtomicInteger();

        @Override
        public Thread newThread(Runnable runnable) {
            Thread thread = new Thread(
                runnable,
                "dig-gopher-" + counter.incrementAndGet()
            );
            thread.setDaemon(true);
            return thread;
        }
    }
}
