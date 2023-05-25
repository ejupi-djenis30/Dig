library protocol_controller;

import 'package:protocol_controller/protocol_controller.dart';

class GopherController extends ProtocolController {
  GopherController(String address, int port, String other_data) : super(address, port, other_data);

  @override
  String make_request() {return "";}
}
