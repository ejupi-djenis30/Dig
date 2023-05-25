library protocol_controller;

import 'dart:core';
import 'dart:io';

/// Classe generica per gestire un protocollo.
abstract class ProtocolController {
  String server;
  int port;
  String other_data;

  ProtocolController(this.server, this.port, this.other_data);

  /// Metodo per fare una richiesta nel determinato protocollo
  /// [query] identifica una eventuale stringa di ricerca (che deve essere già passata in stile URL).
  Future<String> make_request([String query = ""]);

  /// Metodo per ottenere il socket della connessione.
  /// Non deve essere ciamato dall'esterno ma sono internamente alla classe.
  Future<Socket> get_socket() async {
    // Creare espressione regolare per identificare un indirizzo IP.
    RegExp exp = RegExp(r'^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$');

    // Controllare se l'indirizzo che è stato dato è un IP.
    // Se non lo è, si effettua il lookup e lo si trasforma in indirizzo IP.
    var matches = exp.hasMatch(server);
    if (!matches) {
      final address = await InternetAddress.lookup(server);
      server = address.first.address;
    }

    // Ritornare il socket aperto.
    return await Socket.connect(server, port);
  }
}
