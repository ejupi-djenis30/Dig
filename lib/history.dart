import 'package:flutter/material.dart';

class HistoryWidget extends StatefulWidget {
  final List<String> historyItems;
  final void Function(String) searchFunction;

  HistoryWidget({required this.historyItems, required this.searchFunction});

  @override
  _HistoryWidgetState createState() => _HistoryWidgetState();
}

class _HistoryWidgetState extends State<HistoryWidget> {
  List<String> historyItems = [];

  @override
  void initState() {
    super.initState();
    historyItems = widget.historyItems;
  }

  void clearHistory() {
    setState(() {
      historyItems.clear();
    });
  }

  void removeItem(int index) {
    setState(() {
      historyItems.removeAt(index);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        if (historyItems.isNotEmpty)
          Container(
            alignment: Alignment.center,
            child: IconButton(
              icon: Icon(Icons.delete),
              color: Color(0xFF2E2E2E),
              onPressed: () {
                clearHistory();
              },
            ),
          ),
        if (historyItems.isNotEmpty)
          Divider(
            color: Color(0xFF2E2E2E),
            thickness: 1.0,
          ),
        Expanded(
          child: historyItems.isEmpty
              ? Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      'Empty History',
                      style: TextStyle(
                        fontSize: 32,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                )
              : ListView.builder(
                  itemCount: historyItems.length,
                  itemBuilder: (BuildContext context, int index) {
                    final item = historyItems[index];

                    return ListTile(
                      leading: Image.asset(
                        'assets/gopher.png',
                        width: 24,
                        height: 24,
                        color: Color(0xFF2E2E2E),
                      ),
                      title: Text(item),
                      trailing: IconButton(
                        icon: Icon(Icons.delete_outline),
                        color: Color(0xFF2E2E2E),
                        onPressed: () {
                          removeItem(index);
                        },
                      ),
                      onTap: () {
                        widget.searchFunction(item);
                      },
                    );
                  },
                ),
        ),
      ],
    );
  }
}
