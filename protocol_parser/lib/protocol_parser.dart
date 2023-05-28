library protocol_parser;

abstract class ProtocolParser<T> {
  String text;

  ProtocolParser(this.text);

  List<T> parse();
}
