library protocol_controller;

import 'package:protocol_controller/protocol_controller.dart';

import 'dart:core';
import 'dart:io';
import 'dart:async';

/// Classe per gestire il protocollo gopher.
class GopherController extends ProtocolController {
  // Tipi gopher.
  static const String FILE_SELECTOR = "0";
  static const String MENU_SELECTOR = "1";
  static const String ERROR_SELECTOR = "3";
  static const String SEARCH_SELECTOR = "7";
  static const String BINARY_SELECTOR = "9";
  static const String GIF_SELECTOR = "g";
  static const String IMAGE_SELECTOR = "I";
  static const String INTERNET_SELECTOR = "h";
  static const String NONE_SELECTOR = "";
  
  String selector;
  
  GopherController(String address, int port, String other_data, this.selector) : super(address, port, other_data);

  @override
  Future<String> make_request([String query = ""]) async {
    // Ottenere il socket.
    Socket socket = await get_socket();
    String response = "";

    // Se c'è una query string allora si manda anche quella altrimenti si
    // fa una richiesta semplice.
    if (query != "") socket.write("/" + selector + "/" + other_data + "\t" + query + "\r\n");
    else socket.write("/" + selector + "/" + other_data + "\r\n");

    // Ottenere la risposta completa dal server.
    final completer = Completer<void>();
    socket.listen((List<int> data) {
        response = String.fromCharCodes(data);
    }, onDone: () => completer.complete());

    await completer.future;

    // Chiudere il socket e restituire la risposta.
    await socket.close();
    
    return Future.value(response);
  }
}
