import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

class HomeWidget extends StatefulWidget {
  @override
  _HomeWidgetState createState() => _HomeWidgetState();
}

class _HomeWidgetState extends State<HomeWidget>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  List<TabData> _tabs = [
    TabData(icon: Icons.home, title: 'Home'),
    TabData(icon: Icons.history, title: 'History'),
    // Add more tabs as needed
  ];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: _tabs.length, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Row(
          children: [
            Expanded(
              child: TabBar(
                controller: _tabController,
                isScrollable: true,
                tabs: _tabs.map((TabData tab) {
                  return Tab(
                    child: Row(
                      children: [
                        Icon(tab.icon),
                        SizedBox(width: 4),
                        Text(tab.title),
                        SizedBox(width: 4),
                        if (_tabs.indexOf(tab) != _tabController.index)
                          IconButton(
                            icon: Icon(Icons.close),
                            onPressed: () {
                              setState(() {
                                _tabs.remove(tab);
                                _tabController = TabController(
                                  length: _tabs.length,
                                  vsync: this,
                                );
                              });
                            },
                            padding: EdgeInsets.zero,
                            constraints: BoxConstraints(),
                          ),
                      ],
                    ),
                  );
                }).toList(),
              ),
            ),
            IconButton(
              icon: Icon(Icons.add),
              onPressed: () {
                setState(() {
                  _tabs.add(
                    TabData(icon: Icons.tab, title: 'New Tab'),
                  );
                  _tabController = TabController(
                    length: _tabs.length,
                    vsync: this,
                  );
                });
              },
            ),
          ],
        ),
        Expanded(
          child: TabBarView(
            controller: _tabController,
            children: _tabs.map((TabData tab) {
              return Center(
                child: Text(
                  tab.title,
                  style: TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              );
            }).toList(),
          ),
        ),
      ],
    );
  }
}

class TabData {
  final IconData icon;
  final String title;

  TabData({required this.icon, required this.title});
}
