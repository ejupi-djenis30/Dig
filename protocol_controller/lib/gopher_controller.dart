library protocol_controller;

import 'package:protocol_controller/protocol_controller.dart';

import 'dart:core';
import 'dart:io';
import 'dart:async';

class GopherController extends ProtocolController {
  GopherController(String address, int port, String other_data) : super(address, port, other_data);

  @override
  Future<String> make_request() async {
    Socket socket = await get_socket();
    String response = "";
    
    socket.write(other_data + "\r\n");

    final completer = Completer<void>();
    socket.listen((List<int> data) {
        response = String.fromCharCodes(data);
    }, onDone: () => completer.complete());

    await completer.future;

    await socket.close();
    
    return Future.value(response);
  }
}
