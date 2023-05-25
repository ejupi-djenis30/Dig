library protocol_controller;

import 'dart:core';
import 'dart:io';

/// Classe generica per gestire un protocollo.
abstract class ProtocolController {
  String server;
  int port;
  String other_data;

  ProtocolController(this.server, this.port, this.other_data);

  String make_request();

  Future<Socket> get_socket() async {
    RegExp exp = RegExp(r'^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$');

    var matches = exp.hasMatch(server);
    if (!matches) {
      final address = await InternetAddress.lookup(server);
      server = address.first.address;
    }

    return await Socket.connect(server, port);
  }
}
