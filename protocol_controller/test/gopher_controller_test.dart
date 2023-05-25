import 'package:flutter_test/flutter_test.dart';

import 'package:protocol_controller/gopher_controller.dart';
import 'package:logging/logging.dart';

import 'dart:io';

void main() {
  test('Aprire il socket', () async {
    final gopher_controller = GopherController("sdf.org", 70, "/", GopherController.NONE_SELECTOR);
    Socket socket = await gopher_controller.get_socket();
    await socket.close();
  });

  test('Letture dal socket', () async {
    final gopher_controller = GopherController("sdf.org", 70, "/", GopherController.NONE_SELECTOR);
    String data = await gopher_controller.make_request();

    final Logger my_logger = Logger('mylogger');
    final log_file = File('filelog.txt');

    my_logger.onRecord.listen((record) {
      log_file.writeAsStringSync(record.message);
    });

    my_logger.info(data);

    expect(data.contains("sdf"), equals(true));
  });

  test('Motore di ricerca', () async {
    final gopher_controller =
        GopherController("gopher.floodgap.com", 70, "/v2/vs", GopherController.NONE_SELECTOR);
    String data = await gopher_controller.make_request("programming");

    final Logger my_logger = Logger('mylogger');
    final log_file = File('searchlog.txt');

    my_logger.onRecord.listen((record) {
      log_file.writeAsStringSync(record.message);
    });

    my_logger.info(data);

    expect(data.contains("programming"), true);
  });

  test('Selector', () async {
    final gopher_controller =
        GopherController("gopher.floodgap.com", 70, "/maps/", GopherController.MENU_SELECTOR);
    String data = await gopher_controller.make_request();

    
    final Logger my_logger = Logger('mylogger');
    final log_file = File('maplog.txt');

    my_logger.onRecord.listen((record) {
      log_file.writeAsStringSync(record.message);
    });

    my_logger.info(data);
    
    expect(data.contains("maps"), true);
  });

/*  test('File di testo', () async {
    final gopher_controller =
        GopherController("home.quix.us", 70, "/text/programming/author.faq");
    String data = await gopher_controller.make_request();

    final Logger my_logger = Logger('mylogger');
    final log_file = File('filelog.txt');

    my_logger.onRecord.listen((record) {
      log_file.writeAsStringSync(record.message);
    });

    my_logger.info(data);
  }, timeout: Timeout(Duration(minutes: 1)));*/
}
