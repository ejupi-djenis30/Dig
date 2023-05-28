import 'package:protocol_parser/protocol_parser.dart';
import 'package:protocol_controller/gopher_controller.dart';

class GopherElement {
  String element_type;
  String text;
  String path;
  String host;
  int port;

  GopherElement(this.element_type, this.text, this.path, this.host, this.port);
}

class GopherParser extends ProtocolParser<GopherElement> {
  GopherParser(String text) : super(text);

  bool is_identifier_valid(String identifier) {
    switch (identifier) {
      case GopherController.FILE_SELECTOR:
      case GopherController.MENU_SELECTOR:
      case GopherController.ERROR_SELECTOR:
      case GopherController.SEARCH_SELECTOR:
      case GopherController.BINARY_SELECTOR:
      case GopherController.GIF_SELECTOR:
      case GopherController.IMAGE_SELECTOR:
      case GopherController.INTERNET_SELECTOR:
      case GopherController.INFO_SELECTOR:
        return true;
      default:
        return false;
    }
  }

  @override
  List<GopherElement> parse() {
    List<GopherElement> elements = [];
    List<String> lines = text.split("\r\n");

    lines.forEach((line) {
      String identifier = "";

      try {
        identifier = line[0];
      } catch (e) {
        return;
      }

      if (!is_identifier_valid(identifier)) {
        return;
      }

      String filtered_line = line.substring(1);

      List<String> splitted_line = [];
      String text = "";
      String path = "";
      String host = "";
      String debug = "";
      int port = 0;

      if (identifier == GopherController.INFO_SELECTOR) {
        splitted_line = filtered_line.split("\t\t");
      } else {
        splitted_line = filtered_line.split("\t");
      }

      text = splitted_line[0];

      try {
        if (identifier != GopherController.INFO_SELECTOR) {
          path = splitted_line[1];
          host = splitted_line[2];
          port = int.parse(splitted_line[3]);
        }
      } catch (e) {
        return;
      }

      GopherElement element = GopherElement(identifier, text, path, host, port);
      elements.add(element);
    });

    return elements;
  }
}
