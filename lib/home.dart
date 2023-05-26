import 'package:flutter/material.dart';

class HomeWidget extends StatefulWidget {
  List<TabData> tabs = [
    TabData(icon: Icons.tab, title: 'New Tab')
  ];
  HomeWidget({Key? key}) : super(key: key);

  @override
  _HomeWidgetState createState() => _HomeWidgetState();
}

class _HomeWidgetState extends State<HomeWidget>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;


  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: widget.tabs.length, vsync: this);
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
                unselectedLabelColor: Color(0xFFB9B9B9),
                labelColor: Color(0xFF2E2E2E),
                indicatorColor: Color(0xFF2E2E2E),
                isScrollable: true,
                tabs: widget.tabs.map((TabData tab) {
                  return Tab(
                    child: Row(
                      children: [
                        Icon(tab.icon),
                        SizedBox(width: 4),
                        Text(tab.title),
                        SizedBox(width: 4),
                          IconButton(
                            icon: Icon(Icons.close),
                            onPressed: () {
                              setState(() {
                                widget.tabs.remove(tab);
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
                  widget.tabs.add(
                    TabData(icon: Icons.tab, title: 'New Tab'),
                  );
                });
              },
            ),
          ],
        ),
        Expanded(
          child: TabBarView(
            controller: _tabController,
            children: widget.tabs.map((TabData tab) {
              return Center(
                child: Text(
                  tab.title,
                  style: const TextStyle(
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
