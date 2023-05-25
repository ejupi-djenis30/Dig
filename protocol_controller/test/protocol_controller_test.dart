import 'package:flutter_test/flutter_test.dart';

import 'package:protocol_controller/gopher_controller.dart';

import 'dart:io';

void main() {
  test('Aprire il socket', () async {
    final protocol_controller = GopherController("sdf.org", 70, "/");
    Socket socket = await protocol_controller.getSocket();
    await socket.close();
  });
}
