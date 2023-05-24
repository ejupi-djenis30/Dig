import 'package:flutter/material.dart';
import 'package:protocol_controller/protocol_controller.dart';

void main() {
  runApp(MyApp());
}

class MyApp extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Dig Browser',
      theme: ThemeData(
        primarySwatch: Colors.blue,
      ),
      home: MyHomePage(title: 'Dig Browser'),
    );
  }
}

class MyHomePage extends StatefulWidget {
  MyHomePage({Key? key, required this.title}) : super(key: key);
  final String title;

  @override
  _MyHomePageState createState() => _MyHomePageState();
}

class _MyHomePageState extends State<MyHomePage>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  bool isFavorite = false;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 5, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: Color(0xFF2E2E2E),
        automaticallyImplyLeading: true,
        leading: IconButton(
          icon: Icon(
            Icons.replay_sharp,
            color: Color(0xFFB9B9B9),
            size: 24,
          ),
          onPressed: () {
            print('ReloadButton pressed ...');
          },
        ),
        title: TextField(
          decoration: InputDecoration(
            hintText: 'Search',
            hintStyle: TextStyle(
              fontFamily: 'Poppins',
              color: Color(0xFF454545),
            ),
            enabledBorder: UnderlineInputBorder(
              borderSide: BorderSide(
                color: Color(0xFFE8E8E8),
                width: 1,
              ),
              borderRadius: BorderRadius.circular(10),
            ),
            focusedBorder: UnderlineInputBorder(
              borderSide: BorderSide(
                color: Color(0xFF5C5C5C),
                width: 1,
              ),
              borderRadius: BorderRadius.circular(10),
            ),
            errorBorder: UnderlineInputBorder(
              borderSide: BorderSide(
                color: Color(0xFFFF7F7F),
                width: 1,
              ),
              borderRadius: BorderRadius.circular(10),
            ),
            focusedErrorBorder: UnderlineInputBorder(
              borderSide: BorderSide(
                color: Color(0xFFFF7F7F),
                width: 1,
              ),
              borderRadius: BorderRadius.circular(10),
            ),
            filled: true,
            fillColor: Color(0xFFB9B9B9),
            suffixIcon: Icon(
              Icons.http,
              color: Color(0xFF454545),
            ),
          ),
          style: TextStyle(
            fontFamily: 'Poppins',
            color: Color(0xFF454545),
          ),
          textAlign: TextAlign.start,
        ),
        actions: [
          IconButton(
            icon: Icon(
              isFavorite ? Icons.star : Icons.star_outline_rounded,
              color: Color(0xFFB9B9B9),
              size: 24,
            ),
            onPressed: () {
              setState(() {
                isFavorite = !isFavorite;
              });
              print('PreferedButton pressed ...');
            },
          ),
        ],
        centerTitle: true,
        elevation: 4,
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          CustomTabWidget(),
          Container(), // Placeholder for second tab
          Container(), // Placeholder for third tab
          Container(), // Placeholder for fourth tab
          Container(), // Placeholder for fifth tab
        ],
      ),
      bottomNavigationBar: TabBar(
        controller: _tabController,
        unselectedLabelColor: Color(0xFFB9B9B9),
        labelColor: Color(0xFF2E2E2E),
        indicatorColor: Colors.transparent,
        tabs: [
          Tab(
            icon: Icon(Icons.home),
          ),
          Tab(
            icon: Icon(Icons.history),
          ),
          Tab(
            icon: Icon(Icons.star),
          ),
          Tab(
            icon: Icon(Icons.settings),
          ),
          Tab(
            icon: Icon(Icons.download),
          ),
        ],
      ),
    );
  }
}

class CustomTabWidget extends StatefulWidget {
  @override
  _CustomTabWidgetState createState() => _CustomTabWidgetState();
}

class _CustomTabWidgetState extends State<CustomTabWidget>
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
                isScrollable: true, // Enable scrolling for tabs
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
                // Add tab indicator styles as desired
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
