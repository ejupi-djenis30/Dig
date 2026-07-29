package com.ejupilabs.dig;

final class GopherException extends Exception {
    private final String code;

    GopherException(String code, String message) {
        super(message);
        this.code = code;
    }

    String code() {
        return code;
    }
}
