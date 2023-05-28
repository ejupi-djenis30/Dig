import 'package:flutter_test/flutter_test.dart';

import 'package:protocol_parser/gopher_parser.dart';
import 'package:protocol_controller/gopher_controller.dart';

import 'dart:io';

import 'package:logging/logging.dart';

void main() {
  test('Parsare valori', () async {
    File file = File("gopherdump.txt");
    String contents = await file.readAsString();

    GopherParser parser = GopherParser(contents);

    List<GopherElement> parsed = parser.parse();

    GopherElement element = parsed[0];

    expect(element.element_type, GopherController.INFO_SELECTOR);
    expect(element.text,
        "Welcome to the SDF Public Access UNIX System .. est. 1987");

    element = parsed[13];

    final Logger my_logger = Logger('mylogger');
    final log_file = File('txtlog.txt');

    my_logger.onRecord.listen((record) {
      log_file.writeAsStringSync(record.message + "\n");
    });

    my_logger.info(element.debug);

    
    expect(element.element_type, GopherController.MENU_SELECTOR);
    expect(element.text, "SDF PHLOGOSPHERE (439 phlogs)");
    expect(element.path, "/phlogs/");
    expect(element.host, "gopher.club");
    expect(element.port, 70);
  });
}
