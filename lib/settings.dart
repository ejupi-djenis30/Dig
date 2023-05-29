import 'package:flutter/material.dart';

class SettingsWidget extends StatefulWidget {
  String selectedProtocol = "Gopher";

  SettingsWidget();
  @override
  _SettingsWidgetState createState() => _SettingsWidgetState();
}

class _SettingsWidgetState extends State<SettingsWidget> {
  bool cookiesEnabled = false;
  bool javascriptEnabled = false;
  bool popupsBlocked = false;
  bool savePasswords = false;
  bool darkModeEnabled = false;

  List<String> availableProtocols = [
    'Gopher',
    'Gemini',
    'HTTP',
    'WAIS',
    'Finger'
  ];

  @override
  Widget build(BuildContext context) {
    return ListView(
      children: [
        SwitchListTile(
          title: Text('Abilita i cookie'),
          subtitle: Text('Consente ai siti web di salvare i cookie'),
          value: cookiesEnabled,
          onChanged: null,
        ),
        SwitchListTile(
          title: Text('Abilita JavaScript'),
          subtitle: Text('Consente l\'esecuzione di JavaScript sui siti web'),
          value: javascriptEnabled,
          onChanged: null,
        ),
        SwitchListTile(
          title: Text('Blocca popup'),
          subtitle: Text('Blocca i popup indesiderati'),
          value: popupsBlocked,
          onChanged: null,
        ),
        SwitchListTile(
          title: Text('Salva password'),
          subtitle: Text('Salva automaticamente le password dei siti web'),
          value: savePasswords,
          onChanged: null,
        ),
        SwitchListTile(
          title: Text('Modalità scura'),
          subtitle: Text('Abilita la modalità scura per l\'interfaccia'),
          value: darkModeEnabled,
          onChanged: null,
        ),
        ListTile(
          title: Text('Protocollo predefinito'),
          subtitle: DropdownButton<String>(
            value: widget.selectedProtocol,
            onChanged: null,
            items: availableProtocols.map((protocol) {
              return DropdownMenuItem<String>(
                value: protocol,
                child: Text(protocol),
                enabled: protocol == 'Gopher',
              );
            }).toList(),
            onTap: () {
              if (widget.selectedProtocol != 'Gopher') {
                showDialog(
                  context: context,
                  builder: (BuildContext context) {
                    return AlertDialog(
                      title: Text('Selezione non consentita'),
                      content:
                          Text('Puoi selezionare solo il protocollo Gopher.'),
                      actions: <Widget>[
                        TextButton(
                          child: Text('OK'),
                          onPressed: () {
                            Navigator.of(context).pop();
                          },
                        ),
                      ],
                    );
                  },
                );
              }
            },
          ),
        ),
      ],
    );
  }
}
